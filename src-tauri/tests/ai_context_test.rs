//! 阶段 2B 上下文控制：预算裁剪顺序 / 正文缩窗、常驻记忆与作者注的位置、写作规则作用域、
//! 设定卡对 AI 隐藏 / 仅作者可见笔记、「为何被包含」、重试选项。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::context::{assemble, AssembleInput, InjectionInput, Mode};
use bixian::models::{AiTurnOptions, CharacterInput, WritingRuleInput};
use bixian::state::AppState;

fn inj(name: &str, text: &str) -> InjectionInput {
    InjectionInput { name: name.into(), source: "测试".into(), text: text.into(), budget: 0, reason: format!("{name}的来由") }
}

#[test]
fn budget_trims_in_fixed_order_then_shrinks_chapter() {
    let big = "字".repeat(3000);
    let chapter = "正".repeat(6000);
    let history = vec![("user".to_string(), "问".repeat(2000)), ("assistant".to_string(), "答".repeat(2000))];
    let mk = |budget: Option<i64>| AssembleInput {
        book_title: "书",
        chapter_text: &chapter,
        instruction: "继续",
        injections: vec![inj("角色卡", &big), inj("灵感卡", &big), inj("情节块", &big)],
        history: history.clone(),
        mode: Mode::Discuss,
        budget_tokens: budget,
        ..Default::default()
    };
    let full = assemble(&mk(None));
    assert!(full.log.slots.iter().all(|s| !s.trimmed));
    // 预算比全量少「一张卡多一点」→ 裁掉灵感卡还差 1，必须再裁情节块（按顺序）
    let need = full.log.total_est_tokens;
    let one = bixian::util::estimate_tokens(&big);
    let budget = need - one - 1;
    let a = assemble(&mk(Some(budget)));
    let trimmed: Vec<&str> = a.log.slots.iter().filter(|s| s.trimmed).map(|s| s.name.as_str()).collect();
    assert_eq!(trimmed, ["灵感卡", "情节块"], "先裁清单类注入");
    assert!(!a.system.contains("【灵感卡】") && a.system.contains("【角色卡】"));
    assert!(a.log.slots.iter().find(|s| s.name == "灵感卡").unwrap().reason.contains("超出上下文预算"));
    assert!(a.log.total_est_tokens <= budget);
    assert_eq!(a.log.budget_tokens, budget);
    // 极小预算：能裁的都裁了，正文缩窗但至少留 500 字；System 与指令永不裁
    let b = assemble(&mk(Some(600)));
    let cur = b.log.slots.iter().find(|s| s.name == "当前章正文").unwrap();
    assert!(!cur.trimmed && cur.chars >= 500 && cur.chars < 4000, "缩窗：{}", cur.chars);
    assert!(cur.reason.contains("缩窗"));
    assert!(b.log.slots.iter().find(|s| s.name == "对话历史").unwrap().trimmed);
    assert!(b.history.is_empty(), "裁掉的历史不发送");
    assert!(b.user.contains("继续") && b.system.contains("写作顾问"));
}

#[test]
fn memory_goes_to_system_and_author_note_sits_right_before_instruction() {
    let input = AssembleInput {
        book_title: "书",
        chapter_text: "前文。",
        instruction: "写下一幕",
        memory: Some("本书基调：冷峻克制。"),
        memory_reason: Some("本书常驻记忆"),
        author_note: Some("这一段要虐。"),
        retry_hint: Some("这次写得更短"),
        cursor_aware: true,
        ..Default::default()
    };
    let a = assemble(&input);
    assert!(a.system.contains("【常驻记忆】\n本书基调：冷峻克制。"));
    let note = a.user.find("【作者注（本章要求，务必遵守）】").expect("作者注块");
    let instr = a.user.find("【写作指令】").unwrap();
    let before = a.user.find("【光标前文").unwrap();
    assert!(before < note && note < instr, "作者注在正文块之后、指令之前：{}", a.user);
    assert!(a.user.ends_with("写下一幕\n（这次写得更短）"), "重试选项追加在指令后：{}", a.user);
    let names: Vec<&str> = a.log.slots.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["System", "常驻记忆", "光标前文", "作者注", "写作指令"]);
    assert!(a.log.slots.iter().all(|s| !s.reason.is_empty()), "每个槽位都有来由");
}

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    (tmp, s)
}

fn preview(s: &AppState, chapter_id: i64, opts: &AiTurnOptions) -> bixian::context::AssemblyLog {
    let session = cmd::get_or_create_session_inner(s, chapter_id).unwrap();
    cmd::preview_context_inner(s, session.id, "继续", opts).unwrap()
}

fn slot<'a>(log: &'a bixian::context::AssemblyLog, name: &str) -> Option<&'a bixian::context::SlotLog> {
    log.slots.iter().find(|x| x.name == name)
}

#[test]
fn rules_apply_by_scope_and_memory_includes_volume() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let a = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let b = m0::create_chapter_inner(&s, book.id, "二").unwrap();
    let vol = m0::volume_create_inner(&s, book.id, "第一卷", None, &[b.id]).unwrap();
    let rule = |title: &str, mode: &str, ids: Vec<i64>| {
        cmd::rule_upsert_inner(&s, &WritingRuleInput { id: None, book_id: book.id, title: title.into(), content: format!("{title}的内容"), mode: mode.into(), scope_ids: ids }).unwrap()
    };
    rule("第三人称", "always", vec![]);
    rule("一章专用", "scoped", vec![a.id]);
    rule("卷一专用", "scoped", vec![vol.id]);
    let manual = rule("加点打斗", "manual", vec![]);
    cmd::ai_memory_set_inner(&s, "book", book.id, "全书基调冷峻").unwrap();
    cmd::ai_memory_set_inner(&s, "volume", vol.id, "本卷在北境").unwrap();
    cmd::ai_memory_set_inner(&s, "chapter", b.id, "这章要虐").unwrap();

    let la = preview(&s, a.id, &AiTurnOptions::default());
    let ra = slot(&la, "写作规则").unwrap();
    assert!(ra.preview_head.contains("第三人称") && ra.preview_head.contains("一章专用") && !ra.preview_head.contains("卷一专用"));
    assert!(ra.reason.contains("全书常驻：第三人称") && ra.reason.contains("本章 / 本卷适用：一章专用"));
    assert!(slot(&la, "作者注").is_none(), "一章没写作者注");
    assert!(slot(&la, "常驻记忆").unwrap().preview_head.contains("全书基调冷峻"));

    let lb = preview(&s, b.id, &AiTurnOptions { rules: vec![manual.id], ..Default::default() });
    let rb = slot(&lb, "写作规则").unwrap();
    assert!(rb.preview_head.contains("卷一专用") && rb.preview_head.contains("加点打斗") && !rb.preview_head.contains("一章专用"));
    assert!(rb.reason.contains("本轮手选：加点打斗"));
    let mem = slot(&lb, "常驻记忆").unwrap();
    assert!(mem.preview_head.contains("本卷在北境") && mem.reason.contains("本卷「第一卷」"));
    assert_eq!(slot(&lb, "作者注").unwrap().preview_head, "这章要虐");
    // 清空 = 删除
    cmd::ai_memory_set_inner(&s, "chapter", b.id, "  ").unwrap();
    assert_eq!(cmd::ai_memory_get_inner(&s, book.id, Some(b.id)).unwrap().chapter_note, "");
}

#[test]
fn hidden_cards_and_secret_notes_never_reach_the_model() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    m0::write_chapter_inner(&s, ch.id, "南宫婉回头看了晚儿一眼。").unwrap();
    let mk = |name: &str, aliases: &str| {
        m0::character_upsert_inner(&s, &CharacterInput { id: None, book_id: book.id, name: name.into(), role: String::new(), aliases: aliases.into(), description: format!("{name}的小传") }).unwrap()
    };
    let nan = mk("南宫婉", "");
    let lin = mk("林晚", "晚儿");
    let log = preview(&s, ch.id, &AiTurnOptions::default());
    let roles = slot(&log, "角色卡").unwrap();
    assert!(roles.reason.contains("正文提到：南宫婉、晚儿→林晚"), "{}", roles.reason);

    cmd::card_set_ai_hidden_inner(&s, "character", nan.id, true).unwrap();
    cmd::character_set_secret_inner(&s, lin.id, "真实身份：魔教圣女").unwrap();
    let log2 = preview(&s, ch.id, &AiTurnOptions::default());
    let roles2 = slot(&log2, "角色卡").unwrap();
    assert!(!roles2.preview_head.contains("南宫婉的小传") && roles2.preview_head.contains("林晚的小传"));
    assert!(roles2.reason.contains("另有 1 张人物卡设为对 AI 隐藏"));
    assert!(log2.slots.iter().all(|x| !x.preview_head.contains("魔教圣女")), "仅作者可见的笔记不注入");
    // 卡片本身仍带着标记与笔记（供界面显示）
    let back = m0::characters_list_inner(&s, book.id).unwrap();
    assert!(back.iter().any(|c| c.id == nan.id && c.ai_hidden));
    assert!(back.iter().any(|c| c.id == lin.id && c.secret_note == "真实身份：魔教圣女"));
    assert!(cmd::card_set_ai_hidden_inner(&s, "nope", 1, true).is_err());
}

#[test]
fn context_config_budget_defaults_and_flows_into_preview() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let mut cfg = cmd::context_config_get_inner(&s, book.id).unwrap();
    assert_eq!(cfg.budget_tokens, 16000);
    cfg.budget_tokens = 1234;
    cmd::context_config_set_inner(&s, book.id, cfg).unwrap();
    assert_eq!(preview(&s, ch.id, &AiTurnOptions::default()).budget_tokens, 1234);
}
