//! 阶段 2C 组 4：相关章节 / 素材检索、相关段落与素材的 @ 引用、侧聊（不带正式对话历史）。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::models::{AiTurnOptions, ChatTurn, MaterialInput, Mention, ProviderProfile, TransientTask};
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn provider(s: &AppState) {
    let p = cmd::save_provider_inner(
        s,
        ProviderProfile { id: 0, name: "测".into(), base_url: "https://api.test/v1".into(), api_key: "sk".into(), model: "m".into(), max_tokens: 1024, temperature: 0.7 },
    )
    .unwrap();
    cmd::set_active_provider_inner(s, p.id).unwrap();
}

#[test]
fn 相关检索_排除当前章_含素材_带相关段落() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let a = m0::create_chapter_inner(&s, book.id, "渡口").unwrap();
    let b = m0::create_chapter_inner(&s, book.id, "皇城").unwrap();
    let c = m0::create_chapter_inner(&s, book.id, "雪夜").unwrap();
    m0::write_chapter_inner(&s, a.id, "沈砚在渡口等林晚。").unwrap();
    m0::write_chapter_inner(&s, b.id, "皇帝召见群臣。").unwrap();
    m0::write_chapter_inner(&s, c.id, "那年冬天很冷。\n\n沈砚在渡口救下林晚，雪夜渡河。{批注不算}").unwrap();
    {
        let conn = s.db.lock().unwrap();
        repo::materials::upsert(&conn, &MaterialInput { id: None, title: "渡口地形".into(), category: "地名".into(), content: "渡口在旧城以北，冬天河面结冰，林晚常在此等船。".into(), tags: String::new() }).unwrap();
    }
    let hits = cmd::related_search_inner(&s, book.id, Some(a.id), "沈砚想起雪夜渡口的林晚", 5).unwrap();
    let ids: Vec<(String, i64)> = hits.iter().map(|h| (h.kind.clone(), h.id)).collect();
    assert_eq!(ids[0], ("chapter".to_string(), c.id), "{hits:?}");
    assert!(ids.iter().any(|(k, _)| k == "material"), "素材也能检索到");
    assert!(!ids.contains(&("chapter".to_string(), a.id)), "当前章不算");
    assert!(!ids.contains(&("chapter".to_string(), b.id)), "无关的章不返回");
    assert!(hits[0].passage.contains("沈砚在渡口救下林晚") && !hits[0].passage.contains("批注不算"));
}

#[test]
fn 引用相关段落与素材_注入对题的内容() {
    let (_tmp, s) = setup();
    provider(&s);
    let book = m0::create_book_inner(&s, "书").unwrap();
    let a = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let b = m0::create_chapter_inner(&s, book.id, "二").unwrap();
    m0::write_chapter_inner(&s, a.id, "开头一段。\n\n章尾一段。").unwrap();
    let mat = {
        let conn = s.db.lock().unwrap();
        repo::materials::upsert(&conn, &MaterialInput { id: None, title: "金句".into(), category: "金句".into(), content: "雪落无声。".into(), tags: String::new() }).unwrap()
    };
    let sess = cmd::get_or_create_session_inner(&s, b.id).unwrap();
    let opts = AiTurnOptions {
        mentions: vec![
            Mention { kind: "chapter".into(), id: a.id, passage: Some("开头一段。".into()) },
            Mention { kind: "material".into(), id: mat.id, passage: None },
        ],
        ..Default::default()
    };
    let t = cmd::send_prepare(&s, sess.id, "写", &opts).unwrap();
    assert!(t.req.system.contains("相关段落：\n开头一段。"));
    assert!(!t.req.system.contains("章尾摘录"), "有相关段落就不再带章尾");
    assert!(t.req.system.contains("◆ 素材「金句」（金句）\n雪落无声。"));
}

#[test]
fn 侧聊_讨论模式_只带自己的历史_不落库() {
    let (_tmp, s) = setup();
    provider(&s);
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    m0::write_chapter_inner(&s, ch.id, "正文。").unwrap();
    // 正式对话里已有一轮
    let sess = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    {
        let conn = s.db.lock().unwrap();
        let u = repo::sessions::append_message(&conn, sess.id, "user", "正式对话里的问题").unwrap();
        repo::sessions::append_reply(&conn, sess.id, u.id, "正式对话里的回答", "{}").unwrap();
    }
    let before = repo::sessions::list_messages(&s.db.lock().unwrap(), sess.id).unwrap().len();
    let task = TransientTask {
        kind: "discuss".into(),
        chapter_id: Some(ch.id),
        instruction: "这个反派动机够吗？".into(),
        history: vec![ChatTurn { role: "user".into(), content: "侧聊上一问".into() }, ChatTurn { role: "assistant".into(), content: "侧聊上一答".into() }],
        ..Default::default()
    };
    let req = cmd::transient_request(&s, &task).unwrap();
    assert!(req.system.contains("写作顾问"), "讨论模式");
    let hist: Vec<&str> = req.history.iter().map(|(_, c)| c.as_str()).collect();
    assert_eq!(hist, vec!["侧聊上一问", "侧聊上一答"]);
    assert!(!req.user.contains("正式对话里") && !hist.iter().any(|h| h.contains("正式对话里")));
    assert!(req.user.contains("这个反派动机够吗？"));
    assert_eq!(repo::sessions::list_messages(&s.db.lock().unwrap(), sess.id).unwrap().len(), before, "不落库");
    // 空问题拒绝
    assert!(cmd::transient_request(&s, &TransientTask { kind: "discuss".into(), chapter_id: Some(ch.id), ..Default::default() }).is_err());
}
