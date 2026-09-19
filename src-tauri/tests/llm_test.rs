use bixian::db;
use bixian::error::AppError;
use bixian::llm::provider;
use bixian::llm::stream::{parse_sse_line, chat_stream, StreamEvent, StreamReq};
use bixian::models::ProviderProfile;
use bixian::repo;
use rusqlite::Connection;

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    db::init(&mut conn).unwrap();
    conn
}

fn provider(id: i64, name: &str) -> ProviderProfile {
    ProviderProfile {
        id,
        name: name.into(),
        base_url: "https://api.test/v1".into(),
        api_key: "sk-test".into(),
        model: "test-model".into(),
        max_tokens: 1024,
        temperature: 0.7,
    }
}

// ---------- parse_sse_line 纯函数 ----------

#[test]
fn parse_sse_line_extracts_delta_content() {
    let line = "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}";
    assert_eq!(parse_sse_line(line), Some("你好".to_string()));
}

#[test]
fn parse_sse_line_done_marker_is_none() {
    assert_eq!(parse_sse_line("data: [DONE]"), None);
}

#[test]
fn parse_sse_line_heartbeat_and_empty_are_none() {
    assert_eq!(parse_sse_line(": ping"), None);
    assert_eq!(parse_sse_line(""), None);
    assert_eq!(parse_sse_line("event: message"), None);
}

#[test]
fn parse_sse_line_role_only_delta_is_none() {
    let line = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}";
    assert_eq!(parse_sse_line(line), None);
}

#[test]
fn parse_sse_line_null_content_is_none() {
    let line = "data: {\"choices\":[{\"delta\":{\"content\":null}}]}";
    assert_eq!(parse_sse_line(line), None);
}

#[test]
fn parse_sse_line_malformed_json_is_none() {
    assert_eq!(parse_sse_line("data: {not json"), None);
}

// ---------- resolve provider ----------

#[test]
fn resolve_err_when_no_active_provider() {
    let conn = test_conn();
    match provider::resolve(&conn) {
        Err(AppError::Invalid(msg)) => {
            assert!(msg.contains("未配置可用的 AI 服务商"), "实际错误: {msg}");
        }
        other => panic!("期望 Err(Invalid)，实际: {other:?}"),
    }
}

#[test]
fn resolve_returns_active_profile() {
    let conn = test_conn();
    repo::settings::save_provider(&conn, &provider(0, "甲")).unwrap();
    let p2 = repo::settings::save_provider(&conn, &provider(0, "乙")).unwrap();
    repo::settings::set_active_provider(&conn, p2.id).unwrap();

    let got = provider::resolve(&conn).unwrap();
    assert_eq!(got.id, 2);
    assert_eq!(got.name, "乙");
    assert_eq!(got.model, "test-model");
}

#[test]
fn resolve_err_when_active_id_missing() {
    let conn = test_conn();
    repo::settings::save_provider(&conn, &provider(0, "甲")).unwrap();
    repo::settings::set_active_provider(&conn, 999).unwrap();

    let got = provider::resolve(&conn);
    assert!(matches!(got, Err(AppError::Invalid(_))));
}

// ---------- StreamEvent 信封 wire format（Global Constraint 锁形） ----------

#[test]
fn stream_event_serde_envelope_is_snake_case_tagged() {
    assert_eq!(
        serde_json::to_string(&StreamEvent::Delta { text: "你".into() }).unwrap(),
        r#"{"type":"delta","text":"你"}"#
    );
    assert_eq!(
        serde_json::to_string(&StreamEvent::Done { session_id: 3, content: "好".into() }).unwrap(),
        r#"{"type":"done","session_id":3,"content":"好"}"#
    );
    assert_eq!(
        serde_json::to_string(&StreamEvent::Error { message: "x".into() }).unwrap(),
        r#"{"type":"error","message":"x"}"#
    );
}

// ---------- 活体测试（需环境变量，CI/常规跑自动跳过） ----------

/// 需要 BIXIAN_LIVE_BASE_URL / BIXIAN_LIVE_API_KEY / BIXIAN_LIVE_MODEL 三个环境变量；
/// 缺失时直接跳过（`#[ignore]` 之外，`cargo test -- --ignored` 下也无环境变量则空跑通过）。
#[tokio::test]
#[ignore = "活体测试：需真实 OpenAI 兼容端点（BIXIAN_LIVE_* 环境变量）"]
async fn live_stream_smoke() {
    let Ok(base_url) = std::env::var("BIXIAN_LIVE_BASE_URL") else {
        eprintln!("跳过：未设置 BIXIAN_LIVE_BASE_URL");
        return;
    };
    let Ok(api_key) = std::env::var("BIXIAN_LIVE_API_KEY") else {
        eprintln!("跳过：未设置 BIXIAN_LIVE_API_KEY");
        return;
    };
    let Ok(model) = std::env::var("BIXIAN_LIVE_MODEL") else {
        eprintln!("跳过：未设置 BIXIAN_LIVE_MODEL");
        return;
    };

    let req = StreamReq {
        base_url,
        api_key,
        model,
        system: "你是一个复读助手。".into(),
        history: vec![],
        user: "回复：好".into(),
        max_tokens: 64,
        temperature: 0.7,
    };
    let (_cancel_tx, cancel_rx) = tokio::sync::watch::channel(false);
    let mut rx = chat_stream(req, 1, cancel_rx).await.expect("chat_stream 失败");

    let mut text = String::new();
    while let Some(ev) = rx.recv().await {
        match ev {
            StreamEvent::Delta { text: d } => text.push_str(&d),
            StreamEvent::Done { content, .. } => {
                text.push_str(&content);
                break;
            }
            StreamEvent::Error { message } => panic!("流式返回错误: {message}"),
        }
    }
    assert!(!text.is_empty(), "流式输出为空");
}
