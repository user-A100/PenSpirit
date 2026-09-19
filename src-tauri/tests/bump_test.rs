use bixian::bump;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn words(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

// ---- 词库 ----

#[test]
fn seeds_example_words_on_migration() {
    let (_tmp, s) = setup();
    let list = bump::list_words_inner(&s).unwrap();
    assert_eq!(list.len(), 10, "迁移预置 10 个示例词");
    let all: Vec<&str> = list.iter().map(|w| w.word.as_str()).collect();
    for expected in ["蝴蝶", "菜刀", "铁锅", "雨夜", "邮差"] {
        assert!(all.contains(&expected), "缺少示例词 {expected}");
    }
}

#[test]
fn add_is_idempotent_and_rejects_empty_or_overlong() {
    let (_tmp, s) = setup();

    let w = bump::add_word_inner(&s, "  灯塔  ").unwrap();
    assert_eq!(w.word, "灯塔", "首尾空白被裁剪");
    assert_eq!(bump::list_words_inner(&s).unwrap().len(), 11);

    let again = bump::add_word_inner(&s, "灯塔").unwrap();
    assert_eq!(again.id, w.id, "重复加词返回已有那条，不报错也不新增");
    assert_eq!(bump::list_words_inner(&s).unwrap().len(), 11);

    assert!(bump::add_word_inner(&s, "   ").is_err(), "空词");
    assert!(bump::add_word_inner(&s, &"字".repeat(21)).is_err(), "超长词");
}

#[test]
fn delete_and_clear_words() {
    let (_tmp, s) = setup();
    let first = bump::list_words_inner(&s).unwrap()[0].clone();

    bump::delete_word_inner(&s, first.id).unwrap();
    let after = bump::list_words_inner(&s).unwrap();
    assert_eq!(after.len(), 9);
    assert!(!after.iter().any(|w| w.id == first.id));

    bump::clear_words_inner(&s).unwrap();
    assert!(bump::list_words_inner(&s).unwrap().is_empty(), "清空后为空");
    // 清空是持久的：示例词只在迁移里插过一次
    assert!(bump::list_words_inner(&s).unwrap().is_empty());
}

#[test]
fn draw_requires_enough_words() {
    let (_tmp, s) = setup();
    assert!(bump::draw_inner(&s, 4).is_ok(), "10 个词够抽 4 个");

    bump::clear_words_inner(&s).unwrap();
    bump::add_word_inner(&s, "蝴蝶").unwrap();
    let err = bump::draw_inner(&s, 2).unwrap_err();
    assert!(String::from_utf8_lossy(&serde_json::to_vec(&err).unwrap()).contains("至少需要 2 个词"));
}

#[test]
fn draw_clamps_count_to_two_through_four() {
    let (_tmp, s) = setup();
    assert_eq!(bump::draw_inner(&s, 0).unwrap().len(), 2, "低于下限按 2");
    assert_eq!(bump::draw_inner(&s, 99).unwrap().len(), 4, "高于上限按 4");
}

// ---- 随机抽取的确定性 ----

#[test]
fn draw_is_deterministic_for_a_seed() {
    let pool = words(&["蝴蝶", "菜刀", "铁锅", "雨夜", "邮差"]);
    assert_eq!(bump::draw(&pool, 3, 42), bump::draw(&pool, 3, 42), "同种子同结果");
    assert_eq!(bump::draw(&pool, 3, 7), bump::draw(&pool, 3, 7));
}

#[test]
fn draw_produces_distinct_words_from_the_pool() {
    let pool = words(&["蝴蝶", "菜刀", "铁锅", "雨夜", "邮差", "钥匙"]);
    for seed in 0..50u64 {
        let picked = bump::draw(&pool, 4, seed);
        assert_eq!(picked.len(), 4);
        let unique: std::collections::HashSet<&String> = picked.iter().collect();
        assert_eq!(unique.len(), 4, "不重复（seed={seed}）");
        assert!(picked.iter().all(|w| pool.contains(w)), "只从词库里取（seed={seed}）");
    }
}

#[test]
fn draw_returns_whole_pool_when_count_exceeds_it() {
    let pool = words(&["蝴蝶", "菜刀", "铁锅"]);
    let picked = bump::draw(&pool, 10, 5);
    assert_eq!(picked.len(), 3);
    let mut sorted = picked.clone();
    sorted.sort();
    let mut expect = pool.clone();
    expect.sort();
    assert_eq!(sorted, expect, "超出规模时返回全部");
}

#[test]
fn draw_actually_shuffles_across_seeds() {
    let pool = words(&["蝴蝶", "菜刀", "铁锅", "雨夜", "邮差"]);
    let orders: std::collections::HashSet<Vec<String>> =
        (0..50u64).map(|seed| bump::draw(&pool, 5, seed)).collect();
    assert!(orders.len() > 1, "不同种子应产生不同排列，实际 {}", orders.len());
}

// ---- 灵感卡 ----

#[test]
fn ideas_crud_normalizes_json() {
    let (_tmp, s) = setup();

    let idea = bump::create_idea_inner(&s, "  雨夜里的邮差  ", r#"["雨夜","邮差"]"#, r#"["悬疑","  ","都市"]"#)
        .unwrap();
    assert_eq!(idea.content, "雨夜里的邮差", "备注首尾空白裁剪");
    assert_eq!(idea.words_json, r#"["雨夜","邮差"]"#);
    assert_eq!(idea.tags_json, r#"["悬疑","都市"]"#, "空标签被剔除");

    let list = bump::list_ideas_inner(&s).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, idea.id);

    bump::delete_idea_inner(&s, idea.id).unwrap();
    assert!(bump::list_ideas_inner(&s).unwrap().is_empty());
}

#[test]
fn ideas_reject_empty_words_and_bad_json() {
    let (_tmp, s) = setup();
    assert!(bump::create_idea_inner(&s, "备注", "[]", "[]").is_err(), "无词组");
    assert!(bump::create_idea_inner(&s, "备注", "not json", "[]").is_err());
    // 标签非法 JSON 不致命：退化为空标签
    let idea = bump::create_idea_inner(&s, "", r#"["蝴蝶"]"#, "oops").unwrap();
    assert_eq!(idea.tags_json, "[]");
}

#[test]
fn ideas_list_newest_first() {
    let (_tmp, s) = setup();
    let a = bump::create_idea_inner(&s, "第一张", r#"["蝴蝶"]"#, "[]").unwrap();
    let b = bump::create_idea_inner(&s, "第二张", r#"["菜刀"]"#, "[]").unwrap();

    let list = bump::list_ideas_inner(&s).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, b.id, "新的在前");
    assert_eq!(list[1].id, a.id);
}
