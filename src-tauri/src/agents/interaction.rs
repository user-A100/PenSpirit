//! ACP 权限请求交互回路（TurnRegistry 模式的简化版）。
//!
//! 铁律：SDK 的 `session/request_permission` handler 在 dispatch loop 上被调用，
//! **不得在其中阻塞等待用户应答**。这里 handler 只做三件事：生成 request_id、
//! 把 oneshot 发送端登记进 `AppState.pending_perms`、emit `agent://permission`
//! 给前端——然后立即返回。真正的 JSON-RPC 应答由后台 task 在收到前端选择
//! （或 300s 超时 / 回合结束）后经 `Responder::respond` 异步写回。
//!
//! 注：`RequestPermissionRequest` 本身没有 request_id 字段（那是 JSON-RPC 层
//! 的 id），故本地生成进程内唯一 id 供前端回传。

use std::sync::atomic::{AtomicU64, Ordering};

use agent_client_protocol::schema::v1::{
    PermissionOptionKind, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome,
};
use agent_client_protocol::Responder;
use tauri::{Emitter, Manager};

use crate::agents::session::PERMISSION_TIMEOUT;
use crate::error::{AppError, AppResult};
use crate::models::{AcpPermissionEvent, PermOption};
use crate::state::AppState;

static PERM_SEQ: AtomicU64 = AtomicU64::new(1);

/// 待应答权限请求：request_id → 前端选择的通道。
/// 前端选择的是 option_id 字符串；通道被 drop（回合结束/超时）由接收端兜底拒绝。
pub struct PendingPerm {
    pub request_id: String,
    /// 前端回传的 option_id（对应 ACP PermissionOption.option_id）
    pub tx: tokio::sync::oneshot::Sender<String>,
}

/// 生成进程内唯一权限请求 id。
pub fn next_request_id() -> String {
    format!("perm-{}", PERM_SEQ.fetch_add(1, Ordering::Relaxed))
}

fn kind_str(k: &PermissionOptionKind) -> &'static str {
    match k {
        PermissionOptionKind::AllowOnce => "allow_once",
        PermissionOptionKind::AllowAlways => "allow_always",
        PermissionOptionKind::RejectOnce => "reject_once",
        PermissionOptionKind::RejectAlways => "reject_always",
        _ => "other",
    }
}

/// handler 体内调用：登记 + emit + spawn 异步应答。绝不阻塞。
/// 返回 `Ok(())` 表示请求已处理（handler 立即结束）。
pub async fn handle_permission_request(
    app: tauri::AppHandle,
    chat_session_id: i64,
    req: RequestPermissionRequest,
    responder: Responder<RequestPermissionResponse>,
) -> Result<(), agent_client_protocol::Error> {
    let request_id = next_request_id();
    let title = req
        .tool_call
        .fields
        .title
        .clone()
        .unwrap_or_else(|| "未知工具请求".into());
    let options: Vec<PermOption> = req
        .options
        .iter()
        .map(|o| PermOption {
            option_id: o.option_id.to_string(),
            name: o.name.clone(),
            kind: kind_str(&o.kind).to_string(),
        })
        .collect();

    // 1) 登记 oneshot（state 持有发送端）
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let state = app.state::<AppState>();
        let guard = state.pending_perms.lock();
        if let Ok(mut map) = guard {
            map.entry(chat_session_id)
                .or_default()
                .push(PendingPerm { request_id: request_id.clone(), tx });
        }
    }

    // 2) 通知前端（前端必须应答，超时自动拒绝）
    let _ = app.emit(
        "agent://permission",
        AcpPermissionEvent {
            session_id: chat_session_id,
            request_id: request_id.clone(),
            title,
            options,
        },
    );

    // 3) 后台 task 等前端选择 → 异步写回 SDK responder。
    //    超时 / oneshot 被 drop（回合结束清理）→ Cancelled 拒绝。
    tokio::spawn(async move {
        let outcome = match tokio::time::timeout(PERMISSION_TIMEOUT, rx).await {
            Ok(Ok(option_id)) => RequestPermissionOutcome::Selected(
                SelectedPermissionOutcome::new(option_id),
            ),
            _ => RequestPermissionOutcome::Cancelled,
        };
        let _ = responder.respond(RequestPermissionResponse::new(outcome));
    });

    Ok(())
}

/// 前端应答入口（inner 可测）：找到 pending 队列中匹配项，经 oneshot 送出所选
/// option_id。未知 request_id 返回 NotFound；已应答/超时的项早已离开队列。
pub fn respond_permission_inner(
    s: &AppState,
    chat_session_id: i64,
    request_id: &str,
    option_id: &str,
) -> AppResult<()> {
    let mut map = s.pending_perms.lock().map_err(|_| AppError::LockPoisoned)?;
    let queue = map
        .get_mut(&chat_session_id)
        .ok_or_else(|| AppError::NotFound("该会话没有待应答的权限请求".into()))?;
    let idx = queue
        .iter()
        .position(|p| p.request_id == request_id)
        .ok_or_else(|| AppError::NotFound(format!("权限请求不存在或已应答: {request_id}")))?;
    let perm = queue.remove(idx);
    if queue.is_empty() {
        map.remove(&chat_session_id);
    }
    perm.tx
        .send(option_id.to_string())
        .map_err(|_| AppError::Invalid("权限应答通道已关闭".into()))?;
    Ok(())
}

/// 回合结束时清理该会话全部待答请求（onesot drop → 后台 task 收 Err → 自动
/// Cancelled 拒绝，agent 不会卡在等待上）。
pub fn clear_pending(s: &AppState, chat_session_id: i64) {
    if let Ok(mut map) = s.pending_perms.lock() {
        map.remove(&chat_session_id);
    }
}
