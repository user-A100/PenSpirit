//! 阶段 2B 会话管理：置顶 / 归档、分叉、搜索、收藏进素材库；一次性生成的请求组装。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::models::{ProviderProfile, TransientTask};
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    (tmp, s)
}

fn activate_provider(s: &AppState) {
    let p = cmd::save_provider_inner(
        s,
        ProviderProfile { id: 0, name: "测试".into(), base_url: "http://127.0.0.1:9/v1".into(), api_key: "sk-test".into(), model: "m".into(), max_tokens: 512, temperature: 0.7 },
    )
    .unwrap();
    cmd::set_active_provider_inner(s, p.id).unwrap();
}

/// 一章一会话，写入：问 → 两版答（第二版选用）→ 问 → 答
fn sample(s: &AppState) -> (i64, i64, Vec<i64>) {
    let book = m0::create_book_inner(s, "书").unwrap();
    let ch = m0::create_chapter_inner(s, book.id, "雪夜").unwrap();
    let session = cmd::get_or_create_session_inner(s, ch.id).unwrap();
    let conn = s.db.lock().unwrap();
    let q1 = repo::sessions::append_message(&conn, session.id, "user", "北境的雪怎么写").unwrap().id;
    let a1 = repo::sessions::append_reply(&conn, session.id, q1, "第一版：雪落无声。", "{\"mode\":\"write\"}").unwrap().id;
    let a2 = repo::sessions::append_reply(&conn, session.id, q1, "第二版：雪片如刀。", "{\"mode\":\"write\"}").unwrap().id;
    let q2 = repo::sessions::append_message(&conn, session.id, "user", "反派什么时候出场").unwrap().id;
    let a3 = repo::sessions::append_reply(&conn, session.id, q2, "第三章末尾出场。", "{\"mode\":\"discuss\"}").unwrap().id;
    (book.id, session.id, vec![q1, a1, a2, q2, a3])
}

#[test]
fn fork_copies_up_to_message_and_selects_forked_version() {
    let (_tmp, s) = setup();
    let (_, sid, ids) = sample(&s);
    // 在第一版（非选用）处分叉：只带到它为止，且它在新会话里是选用版本
    let forked = cmd::session_fork_inner(&s, sid, ids[1]).unwrap();
    assert!(forked.title.ends_with("（分叉）"));
    let conn = s.db.lock().unwrap();
    let msgs = repo::sessions::list_messages(&conn, forked.id).unwrap();
    assert_eq!(msgs.len(), 2);
    assert_eq!(msgs[0].content, "北境的雪怎么写");
    assert_eq!(msgs[1].reply_to, Some(msgs[0].id), "reply_to 重映射到新会话");
    assert!(msgs[1].active);
    drop(conn);
    // 在最后一问处分叉：两版答都带上（选用状态不变），第二问不带回答
    let f2 = cmd::session_fork_inner(&s, sid, ids[3]).unwrap();
    let conn = s.db.lock().unwrap();
    let m2 = repo::sessions::list_messages(&conn, f2.id).unwrap();
    assert_eq!(m2.len(), 4);
    assert_eq!(m2.iter().filter(|m| m.active && m.role == "assistant").count(), 1);
    assert_eq!(m2.last().unwrap().content, "反派什么时候出场");
    // 原会话不受影响
    assert_eq!(repo::sessions::list_messages(&conn, sid).unwrap().len(), 5);
}

#[test]
fn pin_archive_search_and_star() {
    let (_tmp, s) = setup();
    let (book_id, sid, ids) = sample(&s);
    let ch = { s.db.lock().unwrap().query_row("SELECT chapter_id FROM sessions WHERE id = ?1", [sid], |r| r.get::<_, i64>(0)).unwrap() };
    let other = { repo::sessions::create(&s.db.lock().unwrap(), ch, book_id, "另一个").unwrap() };
    // 置顶的排最前
    cmd::session_set_pinned_inner(&s, sid, true).unwrap();
    let list = cmd::list_sessions_inner(&s, ch).unwrap();
    assert_eq!(list[0].id, sid);
    assert!(list[0].pinned);
    assert!(cmd::session_set_archived_inner(&s, other.id, true).unwrap().archived);
    // 搜索：消息内容命中给摘录；标题命中摘录为空
    let hits = cmd::sessions_search_inner(&s, book_id, "反派").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].chapter_title, "雪夜");
    assert!(hits[0].snippet.contains("反派") && hits[0].message_id.is_some());
    let hits2 = cmd::sessions_search_inner(&s, book_id, "另一个").unwrap();
    assert_eq!(hits2.len(), 1);
    assert!(hits2[0].snippet.is_empty());
    assert!(cmd::sessions_search_inner(&s, book_id, "  ").unwrap().is_empty());
    // 收藏：存进素材库（分类 AI 收藏、标签为章名）；取消收藏不删素材
    let mid = cmd::message_star_inner(&s, ids[2], true).unwrap().expect("素材 id");
    let mats = m0::materials_list_inner(&s, None).unwrap();
    let mat = mats.iter().find(|m| m.id == mid).unwrap();
    assert_eq!(mat.category, "AI 收藏");
    assert_eq!(mat.tags, "雪夜");
    assert_eq!(mat.content, "第二版：雪片如刀。");
    assert_eq!(cmd::message_star_inner(&s, ids[2], false).unwrap(), None);
    assert!(m0::materials_list_inner(&s, None).unwrap().iter().any(|m| m.id == mid));
}

#[test]
fn transient_requests_reuse_context_without_history() {
    let (_tmp, s) = setup();
    let (_, _sid, _) = sample(&s);
    activate_provider(&s);
    let ch = { s.db.lock().unwrap().query_row("SELECT id FROM chapters LIMIT 1", [], |r| r.get::<_, i64>(0)).unwrap() };
    let edit = cmd::transient_request(
        &s,
        &TransientTask { kind: "inline_edit".into(), chapter_id: Some(ch), before: "前文。".into(), selection: "雪落无声。".into(), instruction: "更冷峻".into(), ..Default::default() },
    )
    .unwrap();
    assert!(edit.history.is_empty(), "不带对话历史");
    assert!(edit.user.contains("【选中段落】\n雪落无声。") && edit.user.contains("更冷峻") && edit.user.contains("【光标前文"));
    let cont = cmd::transient_request(&s, &TransientTask { kind: "continue".into(), chapter_id: Some(ch), before: "前文。".into(), target_chars: Some(300), ..Default::default() }).unwrap();
    assert!(cont.user.contains("接着光标处往下写") && cont.user.contains("约 300 字"));
    let ex = cmd::transient_request(&s, &TransientTask { kind: "extract".into(), extract_kind: "character".into(), text: "沈砚与林晚".into(), ..Default::default() }).unwrap();
    assert!(ex.system.contains("只输出 JSON 数组") && ex.user == "沈砚与林晚");
    assert!(cmd::transient_request(&s, &TransientTask { kind: "extract".into(), extract_kind: "nope".into(), ..Default::default() }).is_err());
    assert!(cmd::transient_request(&s, &TransientTask { kind: "inline_edit".into(), chapter_id: Some(ch), ..Default::default() }).is_err(), "改写必须有选区");
}
