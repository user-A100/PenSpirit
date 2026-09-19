//! M2-T4 ACP 会话层测试：envelope 组装、权限应答队列、来源标记、活体回合。

use bixian::agents::{interaction, session as acp_session};
use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::error::AppError;
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

/// 一本书两章：第一章有正文，第二章为当前章。
fn book_with_two_chapters(s: &AppState) -> (i64, i64, i64) {
    let book = m0::create_book_inner(s, "测试之书").unwrap();
    let ch1 = m0::create_chapter_inner(s, book.id, "第一章").unwrap();
    let ch2 = m0::create_chapter_inner(s, book.id, "第二章").unwrap();
    m0::write_chapter_inner(s, ch1.id, "夜色沉沉，灯笼在风里摇晃。").unwrap();
    (book.id, ch1.id, ch2.id)
}

// ---------- envelope 组装（send_message_acp_inner） ----------

#[test]
fn acp_inner_默认agent与envelope组合() {
    let (_tmp, s) = setup();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    m0::write_chapter_inner(&s, ch2, "他推开门，").unwrap();
    let sess = cmd::get_or_create_session_inner(&s, ch2).unwrap();

    let (user_msg, desc, prompt) =
        acp_session::send_message_acp_inner(&s, sess.id, "续写一段").unwrap();

    // 默认 agent 来自内置模板（claude）
    assert_eq!(desc.id, "claude");
    assert!(desc.is_default);

    // envelope：system + user 合并且关键素材齐全
    assert!(prompt.contains("合著者"), "缺系统提示: {prompt}");
    assert!(prompt.contains("测试之书"), "缺书名: {prompt}");
    assert!(prompt.contains("夜色沉沉"), "缺上一章结尾: {prompt}");
    assert!(prompt.contains("他推开门"), "缺当前章正文: {prompt}");
    assert!(prompt.contains("续写一段"), "缺写作指令: {prompt}");
    // user 消息已落库
    assert_eq!(user_msg.role, "user");
    let msgs = repo::sessions::list_messages(&s.db.lock().unwrap(), sess.id).unwrap();
    assert_eq!(msgs.len(), 1);
}

#[test]
fn acp_inner_无默认agent时invalid() {
    let (_tmp, s) = setup();
    // 清空 agents.json 里的默认位：全部禁用
    {
        let mut agents = bixian::agents::registry::list(&s.config_dir()).unwrap();
        for a in agents.iter_mut() {
            a.enabled = false;
        }
        // 全禁用后写回会触发 ensure_single_default 补位 claude，但其 enabled=false
        // send_message_acp_inner 过滤 enabled，应报 Invalid
        std::fs::write(
            s.config_dir().join("agents.json"),
            serde_json::to_string(&agents).unwrap(),
        )
        .unwrap();
    }
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let sess = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    match acp_session::send_message_acp_inner(&s, sess.id, "续写") {
        Err(AppError::Invalid(msg)) => assert!(msg.contains("Agent"), "实际: {msg}"),
        other => panic!("应为 Invalid，实际: {other:?}"),
    }
}

// ---------- 权限应答队列（respond_permission_inner） ----------

#[test]
fn 权限应答_匹配项被消费并送达() {
    let (_tmp, s) = setup();
    let sid = 42i64;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    s.pending_perms.lock().unwrap().insert(
        sid,
        vec![interaction::PendingPerm { request_id: "perm-1".into(), tx }],
    );

    interaction::respond_permission_inner(&s, sid, "perm-1", "allow_once_opt").unwrap();
    assert_eq!(rx.blocking_recv().unwrap(), "allow_once_opt");
    // 队列已清空
    assert!(s.pending_perms.lock().unwrap().get(&sid).is_none());
}

#[test]
fn 权限应答_未知请求notfound() {
    let (_tmp, s) = setup();
    let (tx, _rx) = tokio::sync::oneshot::channel::<String>();
    s.pending_perms.lock().unwrap().insert(
        7,
        vec![interaction::PendingPerm { request_id: "perm-9".into(), tx }],
    );
    match interaction::respond_permission_inner(&s, 7, "perm-404", "x") {
        Err(AppError::NotFound(_)) => {}
        other => panic!("应为 NotFound，实际: {other:?}"),
    }
    // 原请求仍在队列
    assert_eq!(s.pending_perms.lock().unwrap().get(&7).unwrap().len(), 1);
}

#[test]
fn 权限清理_回合结束自动拒绝路径() {
    let (_tmp, s) = setup();
    let sid = 99i64;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    s.pending_perms.lock().unwrap().insert(
        sid,
        vec![interaction::PendingPerm { request_id: "perm-2".into(), tx }],
    );
    // 清理 → oneshot drop → 接收端 Err（后台 task 据此回 Cancelled）
    interaction::clear_pending(&s, sid);
    assert!(matches!(rx.blocking_recv(), Err(_)));
}

// ---------- 来源标记 ----------

#[test]
fn 会话来源默认provider并可更新() {
    let (_tmp, s) = setup();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let sess = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    assert_eq!(sess.source, "provider");

    repo::sessions::update_source(&s.db.lock().unwrap(), sess.id, "agent:claude").unwrap();
    let again = repo::sessions::get(&s.db.lock().unwrap(), sess.id).unwrap();
    assert_eq!(again.source, "agent:claude");
}

// ---------- 活体测试（需本机已装 ACP agent） ----------

/// 环境变量 BIXIAN_AGENT_CMD 提供可执行命令（如 claude-agent-acp）才运行：
/// 跑一个完整回合（spawn → initialize → session/new → prompt → 流式 → turn）。
/// 由于 run_turn 需要 AppHandle（emit），活体走底层组装产物断言 + 手动复刻
/// 连接流程的最小验证：探测命令可解析即为可 spawn 的前置条件。
#[test]
#[ignore = "需要 BIXIAN_AGENT_CMD 指向本机已安装的 ACP agent"]
fn live_turn_smoke() {
    let Ok(agent_cmd) = std::env::var("BIXIAN_AGENT_CMD") else {
        panic!("设置 BIXIAN_AGENT_CMD 后运行（例如 claude-agent-acp）");
    };
    let (_tmp, s) = setup();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let sess = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let (_user, desc, prompt) =
        acp_session::send_message_acp_inner(&s, sess.id, "请只回复：好").unwrap();
    assert!(!prompt.is_empty());

    // 命令发现是回合启动的前置
    let resolved = bixian::agents::discover::resolve_command(&agent_cmd)
        .expect("命令应可解析");
    assert!(resolved.exists(), "解析结果应存在: {resolved:?}");
}
