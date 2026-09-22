//! M7 批次6 注入原子收集语义：关键词命中 / 未回收伏笔 / 手动勾选 / 配置读写。

use bixian::commands as cmd;
use bixian::context::inject;
use bixian::models::{default_context_config, CharacterInput, ContextConfig, ForeshadowInput, PlotBlockInput, SlotConfig};
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn slot<'a>(injs: &'a [bixian::context::InjectionInput], name: &str) -> &'a bixian::context::InjectionInput {
    injs.iter().find(|i| i.name == name).unwrap_or_else(|| panic!("缺少槽位 {name}"))
}

fn character(book_id: i64, name: &str, role: &str, aliases: &str, description: &str) -> CharacterInput {
    CharacterInput { id: None, book_id, name: name.into(), role: role.into(), aliases: aliases.into(), description: description.into() }
}

#[test]
fn characters_hit_by_name_or_alias_and_all_injects_everyone() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    {
        let conn = s.db.lock().unwrap();
        bixian::repo::characters::upsert(&conn, &character(book.id, "林远山", "主角", "阿山, 远山", "沉默寡言。")).unwrap();
        bixian::repo::characters::upsert(&conn, &character(book.id, "白薇", "配角", "", "掌柜之女。")).unwrap();
    }

    // 正文只提「阿山」（别名命中）→ 只注入林远山
    let injs = {
        let conn = s.db.lock().unwrap();
        inject::collect(&conn, book.id, None, "夜色里，阿山握紧了刀。").unwrap()
    };
    let card = slot(&injs, "角色卡");
    assert_eq!(card.source, "关键词命中 1 人");
    assert!(card.text.contains("- 林远山（主角；别名：阿山/远山）：沉默寡言。"));
    assert!(!card.text.contains("白薇"));

    // all=true → 全量
    let mut cfg = default_context_config();
    cfg.characters.all = true;
    {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let injs = inject::collect(&conn, book.id, None, "夜色里，阿山握紧了刀。").unwrap();
        assert_eq!(slot(&injs, "角色卡").source, "全量注入 2 人");
    }

    // 未命中 → 无角色卡槽位
    {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &default_context_config()).unwrap();
        let injs = inject::collect(&conn, book.id, None, "渡口的灯笼亮了。").unwrap();
        assert!(injs.iter().all(|i| i.name != "角色卡"));
    }
}

#[test]
fn foreshadows_only_active_with_ordinals_distance_and_ids_filter() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap().id;
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap().id;
    let c3 = cmd::create_chapter_inner(&s, book.id, "三").unwrap().id;

    let fs_input = |title: &str, planted: i64, target: Option<i64>| ForeshadowInput {
        id: None, book_id: book.id, title: title.into(), planted_chapter_id: planted,
        target_chapter_id: target, note: "备注".into(), override_note: String::new(), repay_chapter_id: None,
    };
    let ids: Vec<i64> = {
        let conn = s.db.lock().unwrap();
        let a = bixian::repo::foreshadows::upsert(&conn, &fs_input("夜归人", c1, Some(c3))).unwrap().id;
        let r = bixian::repo::foreshadows::upsert(&conn, &fs_input("旧刀", c1, None)).unwrap().id;
        let d = bixian::repo::foreshadows::upsert(&conn, &fs_input("哑铃", c2, None)).unwrap().id;
        bixian::repo::foreshadows::set_status(&conn, r, "resolved", Some(c3)).unwrap();
        bixian::repo::foreshadows::set_status(&conn, d, "dropped", None).unwrap();
        vec![a, r, d]
    };

    // 默认配置：active 自动列出，序号/距离按章节目录序
    let injs = {
        let conn = s.db.lock().unwrap();
        inject::collect(&conn, book.id, Some(c3), "").unwrap()
    };
    let f = slot(&injs, "伏笔提醒");
    assert_eq!(f.source, "未回收 1 条");
    assert!(f.text.contains("- 「夜归人」第1章埋设（距当前 2 章），计划第3章回收：备注"), "实际：{}", f.text);

    // ids 圈定 + override_note 优先
    let mut cfg = default_context_config();
    cfg.foreshadows.ids = Some(vec![ids[1]]);
    {
        let conn = s.db.lock().unwrap();
        // 旧刀已 resolved → ids 圈中也只看 active → 无槽位
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let injs = inject::collect(&conn, book.id, None, "").unwrap();
        assert!(injs.iter().all(|i| i.name != "伏笔提醒"));
        // 新增一条 active 且带 override_note
        let o = bixian::repo::foreshadows::upsert(&conn, &fs_input("灯笼", c2, None)).unwrap().id;
        bixian::repo::foreshadows::upsert(&conn, &ForeshadowInput {
            id: Some(o), override_note: "放行理由优先".into(), ..fs_input("灯笼", c2, None)
        }).unwrap();
        cfg.foreshadows.ids = Some(vec![o]);
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let injs = inject::collect(&conn, book.id, Some(c3), "").unwrap();
        let f = slot(&injs, "伏笔提醒");
        assert!(f.text.contains("：放行理由优先"), "override_note 优先：{}", f.text);
        assert!(!f.text.contains("备注"));
    }

    // 埋设章软删 → 「埋设章已删」，且因当前章序在前不标距离
    cmd::delete_chapter_inner(&s, c2).unwrap();
    {
        let conn = s.db.lock().unwrap();
        cfg.foreshadows.ids = None;
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let injs = inject::collect(&conn, book.id, Some(c1), "").unwrap();
        let f = slot(&injs, "伏笔提醒");
        let lantern = f.text.lines().find(|l| l.contains("灯笼")).unwrap();
        assert!(lantern.contains("埋设章已删"), "实际：{lantern}");
        assert!(!lantern.contains("距当前"), "埋设章已删不标距离：{lantern}");
        // 夜归人埋设章 == 当前章 → 合法地标注「距当前 0 章」
        let night = f.text.lines().find(|l| l.contains("夜归人")).unwrap();
        assert!(night.contains("距当前 0 章"), "实际：{night}");
    }
}

#[test]
fn plots_and_ideas_respect_ids_filter_and_none_means_all() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let (b1, b2) = {
        let conn = s.db.lock().unwrap();
        let i1 = bixian::repo::plot_blocks::upsert(&conn, &PlotBlockInput { id: None, book_id: book.id, content: "雪夜追杀".into(), status: "ready".into(), chapter_id: None, sort_key: 1 }).unwrap().id;
        bixian::repo::plot_blocks::upsert(&conn, &PlotBlockInput { id: None, book_id: book.id, content: "渡口重逢".into(), status: "idea".into(), chapter_id: None, sort_key: 2 }).unwrap();
        let k1 = bixian::repo::ideas::create(&conn, "雨声中的密信", r#"["雨","密信"]"#, "[]").unwrap().id;
        bixian::repo::ideas::create(&conn, "古钟下藏钥", "[]", "[]").unwrap();
        (i1, k1)
    };

    // 勾选单块
    let mut cfg = default_context_config();
    cfg.plots.enabled = true;
    cfg.plots.ids = Some(vec![b1]);
    cfg.ideas.enabled = true;
    cfg.ideas.ids = Some(vec![b2]);
    let injs = {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &cfg).unwrap();
        inject::collect(&conn, book.id, None, "").unwrap()
    };
    assert_eq!(slot(&injs, "情节块").source, "勾选 1 块");
    assert!(slot(&injs, "情节块").text.contains("- 雪夜追杀"));
    assert_eq!(slot(&injs, "灵感卡").source, "勾选 1 张");
    assert!(slot(&injs, "灵感卡").text.contains("- 雨 · 密信：雨声中的密信"));

    // ids=None → 全部
    cfg.plots.ids = None;
    cfg.ideas.ids = None;
    let injs = {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &cfg).unwrap();
        inject::collect(&conn, book.id, None, "").unwrap()
    };
    assert_eq!(slot(&injs, "情节块").source, "全部 2 块");
    assert_eq!(slot(&injs, "灵感卡").source, "全部 2 张");
}

#[test]
fn disabled_slots_and_budgets_flow_through() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let mut cfg = default_context_config();
    cfg.plots.enabled = true;
    cfg.plots.budget = 300;
    {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &cfg).unwrap();
        bixian::repo::plot_blocks::upsert(&conn, &PlotBlockInput { id: None, book_id: book.id, content: "块".into(), status: "idea".into(), chapter_id: None, sort_key: 1 }).unwrap();
        let injs = inject::collect(&conn, book.id, None, "").unwrap();
        assert!(injs.iter().all(|i| i.name != "灵感卡"), "默认关闭的灵感卡不出现");
        assert_eq!(slot(&injs, "情节块").budget, 300);
    }
    // 负预算钳到 0（=不限，由装配器解释）
    cfg.plots.budget = -5;
    {
        let conn = s.db.lock().unwrap();
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let injs = inject::collect(&conn, book.id, None, "").unwrap();
        assert_eq!(slot(&injs, "情节块").budget, 0);
    }
}

#[test]
fn config_roundtrip_default_and_corrupt_guard() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let cfg = ContextConfig {
        characters: SlotConfig { enabled: true, budget: 2000, ids: None, all: true },
        foreshadows: SlotConfig { enabled: false, budget: 0, ids: Some(vec![1]), all: false },
        plots: SlotConfig { enabled: true, budget: 500, ids: Some(vec![2, 3]), all: false },
        ideas: SlotConfig { enabled: false, budget: 100, ids: None, all: false },
    };
    {
        let conn = s.db.lock().unwrap();
        // 无记录 → 默认
        let d = inject::load_config(&conn, book.id).unwrap();
        assert_eq!(d.characters.budget, default_context_config().characters.budget);
        assert!(!default_context_config().plots.enabled);
        // 存取往返
        inject::store_config(&conn, book.id, &cfg).unwrap();
        let loaded = inject::load_config(&conn, book.id).unwrap();
        assert_eq!(loaded.characters.budget, 2000);
        assert!(loaded.characters.all);
        assert!(!loaded.foreshadows.enabled);
        assert_eq!(loaded.plots.ids, Some(vec![2, 3]));
    }
    // 两本书互不影响（create_book_inner 内部会再拿锁，必须在持锁块外调用）
    let other = cmd::create_book_inner(&s, "他书").unwrap();
    {
        let conn = s.db.lock().unwrap();
        assert_eq!(inject::load_config(&conn, other.id).unwrap().characters.budget, default_context_config().characters.budget);
        // 脏数据 → 明确报错而非 panic
        bixian::repo::settings::set(&conn, &format!("context:book:{}", book.id), "{{oops").unwrap();
        let err = inject::load_config(&conn, book.id).unwrap_err();
        assert!(err.to_string().contains("注入配置数据损坏"));
    }
}
