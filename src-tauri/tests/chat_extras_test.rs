//! 阶段 2C 组 1：回答评分（按命令统计）、导出对话文件。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

#[test]
fn 评分按命令统计() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let sess = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let ids: Vec<i64> = {
        let conn = s.db.lock().unwrap();
        let u = repo::sessions::append_message(&conn, sess.id, "user", "问").unwrap();
        [r#"{"command":"polish"}"#, r#"{"command":"polish"}"#, r#"{"command":"custom:p1"}"#, r#"{"mode":"write"}"#]
            .iter()
            .map(|m| repo::sessions::append_reply(&conn, sess.id, u.id, "答", m).unwrap().id)
            .collect()
    };
    assert_eq!(cmd::message_rate_inner(&s, ids[0], 1).unwrap().rating, 1);
    cmd::message_rate_inner(&s, ids[1], -5).unwrap(); // 夹到 -1
    cmd::message_rate_inner(&s, ids[2], 1).unwrap();
    cmd::message_rate_inner(&s, ids[3], 1).unwrap(); // 无命令：不进统计
    let stats = cmd::rating_stats_inner(&s).unwrap();
    let got: Vec<(String, i64, i64)> = stats.into_iter().map(|r| (r.command, r.up, r.down)).collect();
    assert_eq!(got, vec![("custom:p1".to_string(), 1, 0), ("polish".to_string(), 1, 1)]);
    // 取消评分
    assert_eq!(cmd::message_rate_inner(&s, ids[2], 0).unwrap().rating, 0);
    assert_eq!(cmd::rating_stats_inner(&s).unwrap().len(), 1);
}

#[test]
fn 导出对话只允许_md_txt() {
    let tmp = tempfile::tempdir().unwrap();
    let ok = tmp.path().join("子目录/对话.md");
    cmd::export_text_file_inner(&ok, "# 标题").unwrap();
    assert_eq!(std::fs::read_to_string(&ok).unwrap(), "# 标题");
    assert!(cmd::export_text_file_inner(&tmp.path().join("x.exe"), "坏").is_err());
    assert!(cmd::export_text_file_inner(&tmp.path().join("无后缀"), "坏").is_err());
}
