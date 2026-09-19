//! ACP 会话主流程：spawn → initialize → session/new → prompt → 流式转发 →
//! 落库 + turn 事件。取消走 watch 通道（复用 M1 的 cancels 基建）。
//!
//! envelope 模式：ACP 的 prompt 没有 system 字段，ContextAssembler 的产物
//! （system + user）合并为单条 prompt 文本——文风卡/前文滑窗/指令全部保留。

use std::path::PathBuf;
use std::time::{Duration, Instant};

use agent_client_protocol::schema::v1::{
    CancelNotification, ContentBlock, InitializeRequest, McpServer, McpServerStdio,
    RequestPermissionRequest, SessionNotification, SessionUpdate,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{
    AcpAgent, Agent, Client, ConnectionTo, SessionMessage, util::MatchDispatch,
};
use tauri::{Emitter, Manager};

use crate::agents::coalesce::StreamCoalescer;
use crate::agents::discover;
use crate::agents::interaction;
use crate::commands_ai::{assemble_with, gather_context};
use crate::error::{AppError, AppResult};
use crate::models::{AcpStreamEvent, AcpTurnEvent, AgentDescriptor, ChatMessage};
use crate::repo;
use crate::state::AppState;

/// 单回合总预算（续写长回合放宽到 10 分钟；超时杀进程树）。
pub const TURN_TIMEOUT: Duration = Duration::from_secs(600);
/// 权限应答等待上限（前端无响应自动拒绝）。
pub const PERMISSION_TIMEOUT: Duration = Duration::from_secs(300);
/// 流式 flush 时间片（与 coalesce::FLUSH_INTERVAL 一致）。
const FLUSH_TICK: Duration = Duration::from_millis(40);

/// 组装 + 落库 user 消息 + 选默认 agent，产出 (user_msg, agent, prompt_text)。
/// 不 spawn、不登记取消信号——命令薄包装负责启动 run_turn。
pub fn send_message_acp_inner(
    s: &AppState,
    session_id: i64,
    instruction: &str,
) -> AppResult<(ChatMessage, AgentDescriptor, String)> {
    let desc = {
        let list = crate::agents::registry::list(&s.config_dir())?;
        list.into_iter()
            .find(|a| a.is_default && a.enabled)
            .ok_or_else(|| AppError::Invalid("未配置默认 Agent，请到设置中启用".into()))?
    };
    let bundle = gather_context(s, session_id)?;
    let assembled = assemble_with(&bundle, instruction);
    // envelope：ACP 无 system/history 字段，三段全部编入单条 prompt
    // （history 是「【上一章结尾】…」条目，放最前作前情提要）
    let mut prompt_text = String::new();
    for (_role, content) in &assembled.history {
        prompt_text.push_str(content);
        prompt_text.push_str("\n\n");
    }
    prompt_text.push_str(&assembled.system);
    prompt_text.push_str("\n\n");
    prompt_text.push_str(&assembled.user);
    let user_msg = {
        let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
        repo::sessions::append_message(&conn, session_id, "user", instruction)?
    };
    Ok((user_msg, desc, prompt_text))
}

/// 回合产物：闭包内部不返回 Err（错误也带上已收到的部分内容），外层只区分
/// 完成与全局超时。
struct TurnOutcome {
    ok: bool,
    content: String,
    error: Option<String>,
}

/// 一回合完整执行（在 tauri::async_runtime::spawn 里跑）。所有出口统一：
/// assistant 落库（content 非空时）→ emit agent://turn → 清理取消信号与权限队列。
pub async fn run_turn(
    app: tauri::AppHandle,
    chat_session_id: i64,
    desc: AgentDescriptor,
    prompt_text: String,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) {
    let s = app.state::<AppState>();
    let outcome =
        run_turn_inner(&app, s.inner(), chat_session_id, &desc, &prompt_text, &mut cancel_rx)
            .await;

    // 落库 assistant（有内容才落）
    if !outcome.content.is_empty() {
        let saved = s
            .db
            .lock()
            .map_err(|_| AppError::LockPoisoned)
            .and_then(|conn| {
                repo::sessions::append_message(&conn, chat_session_id, "assistant", &outcome.content)
            });
        if let Err(e) = saved {
            let _ = app.emit(
                "agent://turn",
                AcpTurnEvent {
                    session_id: chat_session_id,
                    ok: false,
                    content: Some(outcome.content.clone()),
                    error: Some(format!("结果落库失败: {e}")),
                },
            );
            cleanup(s.inner(), chat_session_id);
            return;
        }
    }
    let _ = app.emit(
        "agent://turn",
        AcpTurnEvent {
            session_id: chat_session_id,
            ok: outcome.ok,
            content: if outcome.content.is_empty() { None } else { Some(outcome.content) },
            error: outcome.error,
        },
    );
    cleanup(s.inner(), chat_session_id);
}

fn cleanup(s: &AppState, chat_session_id: i64) {
    if let Ok(mut cancels) = s.cancels.lock() {
        cancels.remove(&chat_session_id);
    }
    interaction::clear_pending(s, chat_session_id);
}

async fn run_turn_inner(
    app: &tauri::AppHandle,
    s: &AppState,
    chat_session_id: i64,
    desc: &AgentDescriptor,
    prompt_text: &str,
    cancel_rx: &mut tokio::sync::watch::Receiver<bool>,
) -> TurnOutcome {
    // 命令发现（GUI 进程 PATH 与终端不同）
    let Some(command) = discover::resolve_command(&desc.command) else {
        return TurnOutcome {
            ok: false,
            content: String::new(),
            error: Some(format!(
                "未找到命令 `{}`：请先安装对应 ACP 适配器（设置 → Agent 有安装指引）",
                desc.command
            )),
        };
    };

    // 工作目录 = 书目录（agent 的文件操作锚点）
    let cwd: PathBuf = {
        let conn = match s.db.lock() {
            Ok(c) => c,
            Err(_) => {
                return TurnOutcome { ok: false, content: String::new(), error: Some("数据库锁定".into()) };
            }
        };
        let session = match repo::sessions::get(&conn, chat_session_id) {
            Ok(v) => v,
            Err(e) => {
                return TurnOutcome { ok: false, content: String::new(), error: Some(e.to_string()) };
            }
        };
        match repo::books::get(&conn, session.book_id) {
            Ok(book) => s.root.join(&book.slug),
            Err(e) => {
                return TurnOutcome { ok: false, content: String::new(), error: Some(e.to_string()) };
            }
        }
    };

    let stdio = McpServerStdio::new(desc.id.clone(), command).args(desc.args.clone());
    let agent = AcpAgent::new(McpServer::Stdio(stdio));

    let app_perm = app.clone();
    let sid = chat_session_id;
    let app_run = app.clone();
    let prompt = prompt_text.to_string();
    let cwd_run = cwd;
    let cancel_rx_owned = cancel_rx.clone();

    let connect = Client
        .builder()
        .name("bixian")
        .on_receive_request(
            async move |req: RequestPermissionRequest,
                        responder,
                        _cx: ConnectionTo<Agent>| {
                // 铁律：handler 内只登记 + emit + spawn 异步应答，立即返回
                let app = app_perm.clone();
                interaction::handle_permission_request(app, sid, req, responder).await
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
            Ok(run_session(connection, app_run, sid, cwd_run, prompt, cancel_rx_owned).await)
        });

    // 全局超时兜底（超时 drop connect future → SDK ChildGuard kill 进程树）
    match tokio::time::timeout(TURN_TIMEOUT, connect).await {
        Ok(Ok(outcome)) => outcome,
        Ok(Err(e)) => TurnOutcome {
            ok: false,
            content: String::new(),
            error: Some(format!("ACP 连接失败: {e}")),
        },
        Err(_) => TurnOutcome {
            ok: false,
            content: String::new(),
            error: Some(format!("回合超时（{} 分钟）", TURN_TIMEOUT.as_secs() / 60)),
        },
    }
}

/// 连接就绪后的会话循环。闭包内不抛错：任何失败都转 TurnOutcome。
async fn run_session(
    connection: ConnectionTo<Agent>,
    app: tauri::AppHandle,
    chat_session_id: i64,
    cwd: PathBuf,
    prompt_text: String,
    mut cancel_rx: tokio::sync::watch::Receiver<bool>,
) -> TurnOutcome {
    let fail = |msg: String| TurnOutcome { ok: false, content: String::new(), error: Some(msg) };

    // initialize
    if let Err(e) = connection
        .send_request(InitializeRequest::new(ProtocolVersion::V1))
        .block_task()
        .await
    {
        return fail(format!("agent 初始化失败: {e}"));
    }

    // session/new（cwd = 书目录；笔仙不注入 MCP server）
    let mut session = match connection.build_session(&cwd).block_task().start_session().await {
        Ok(s) => s,
        Err(e) => return fail(format!("创建会话失败: {e}")),
    };
    if let Err(e) = session.send_prompt(prompt_text) {
        return fail(format!("发送指令失败: {e}"));
    }

    let mut coalescer = StreamCoalescer::new();
    let mut full = String::new();
    let mut flush_tick = tokio::time::interval(FLUSH_TICK);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut cancelled = false;

    loop {
        tokio::select! {
            msg = session.read_update() => {
                match msg {
                    Ok(SessionMessage::StopReason(_)) => break,
                    Ok(SessionMessage::SessionMessage(dispatch)) => {                        let handled = MatchDispatch::new(dispatch)
                            .if_notification(async |notif: SessionNotification| {
                                if let SessionUpdate::AgentMessageChunk(chunk) = notif.update {
                                    if let ContentBlock::Text(t) = chunk.content {
                                        full.push_str(&t.text);
                                        coalescer.push(&t.text);
                                    }
                                }
                                Ok(())
                            })
                            .await
                            .otherwise_ignore();
                        if handled.is_err() {
                            break;
                        }
                    }
                    // SessionMessage 标记 non_exhaustive：未来变体先忽略
                    Ok(_) => {}
                    Err(e) => {
                        let _ = flush(&app, chat_session_id, &mut coalescer);
                        return TurnOutcome { ok: false, content: full, error: Some(format!("会话中断: {e}")) };
                    }
                }
            }
            _ = flush_tick.tick() => {
                let _ = flush(&app, chat_session_id, &mut coalescer);
            }
            _ = cancel_rx.changed() => {
                if *cancel_rx.borrow() {
                    cancelled = true;
                    // 优雅取消：通知 agent 停止当前回合，随后退出
                    let _ = connection.send_notification(CancelNotification::new(
                        session.session_id().clone(),
                    ));
                    break;
                }
            }
        }
    }

    let _ = flush(&app, chat_session_id, &mut coalescer);
    TurnOutcome {
        ok: true,
        content: full,
        error: if cancelled { Some("已停止".into()) } else { None },
    }
}

fn flush(
    app: &tauri::AppHandle,
    chat_session_id: i64,
    coalescer: &mut StreamCoalescer,
) -> tauri::Result<()> {
    if let Some(text) = coalescer.take_if_due(Instant::now()) {
        app.emit(
            "agent://stream",
            AcpStreamEvent { session_id: chat_session_id, text },
        )?;
    }
    Ok(())
}
