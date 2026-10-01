//! 阶段 2B 生成控制：多候选 / 重试选项记入 meta、/压缩 摘要代替此前对话。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::models::AiTurnOptions;
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    (tmp, s)
}

#[test]
fn compact_summary_replaces_earlier_history() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let conn = s.db.lock().unwrap();
    let say = |role: &str, text: &str, reply_to: Option<i64>, meta: &str| {
        let m = repo::sessions::append_message(&conn, session.id, role, text).unwrap();
        if role == "assistant" {
            conn.execute("UPDATE messages SET reply_to = ?2, meta = ?3 WHERE id = ?1", rusqlite::params![m.id, reply_to, meta]).unwrap();
        }
        m.id
    };
    let q1 = say("user", "早期问题", None, "");
    say("assistant", "早期回答", Some(q1), "{\"mode\":\"discuss\"}");
    let q2 = say("user", "请压缩", None, "");
    say("assistant", "摘要：主角在北境。", Some(q2), "{\"mode\":\"discuss\",\"command\":\"compact\"}");
    let q3 = say("user", "接着聊反派", None, "");
    say("assistant", "反派动机……", Some(q3), "{\"mode\":\"discuss\"}");
    let h = repo::sessions::history_for_assembly(&conn, session.id, None).unwrap();
    let texts: Vec<&str> = h.iter().map(|(_, c)| c.as_str()).collect();
    assert_eq!(texts[1], "摘要：主角在北境。");
    assert!(texts[0].contains("压缩摘要"));
    assert_eq!(&texts[2..], ["接着聊反派", "反派动机……"]);
    assert!(!texts.iter().any(|t| t.contains("早期")), "压缩之前的对话不再发送");
}

#[test]
fn candidates_and_retry_hint_flow_into_prompt_and_meta() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let opts = AiTurnOptions { retry_hint: Some("这次写得更短".into()), candidates: Some(3), ..Default::default() };
    let log = cmd::preview_context_inner(&s, session.id, "继续", &opts).unwrap();
    assert!(log.slots.iter().any(|x| x.name == "写作指令"));
    // meta：通过 send_prepare 取（需要服务商；未配时报错不落库——这里只校验 turn_meta 的拼装）
    let meta = cmd::turn_meta_for_test(&opts);
    assert!(meta.contains("\"candidates\":3") && meta.contains("\"retry\":\"这次写得更短\""), "{meta}");
}
