//! M2 ACP agent 模块：注册表（registry）/ 命令发现（discover）/
//! 短连接探测（probe）/ 流式合并（coalesce）/ 权限交互（interaction）/
//! 会话主流程（session）。命令层沿用 inner 可测 + `#[tauri::command]`
//! 薄包装模式；`agents_probe` / `send_message_acp` 为 async command。

pub mod changes;
pub mod coalesce;
pub mod discover;
pub mod interaction;
pub mod probe;
pub mod registry;
pub mod session;
pub mod tools;

use std::path::PathBuf;

use tauri::{AppHandle, State};

use crate::error::{AppError, AppResult};
use crate::models::{AgentDescriptor, AgentUndoResult, AiTurnOptions, ChatMessage, ProbeResult};
use crate::state::AppState;

// ---------- inner（可测） ----------

pub fn agents_list_inner(config_dir: &PathBuf) -> AppResult<Vec<AgentDescriptor>> {
    registry::list(config_dir)
}

/// 探测指定 agent 并把结果回写 agents.json 的 last_probe。
/// inner 接受 config 路径参数以便测试。
pub async fn agents_probe_inner(config_dir: &PathBuf, id: &str) -> AppResult<ProbeResult> {
    let desc = registry::list(config_dir)?
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| AppError::NotFound(format!("agent 不存在: {id}")))?;
    let result = probe::probe(&desc).await;
    let mut with_probe = desc;
    with_probe.last_probe = Some(result.clone());
    registry::upsert(config_dir, &with_probe)?;
    Ok(result)
}

pub fn agents_upsert_inner(config_dir: &PathBuf, desc: &AgentDescriptor) -> AppResult<()> {
    registry::upsert(config_dir, desc)
}

pub fn agents_remove_inner(config_dir: &PathBuf, id: &str) -> AppResult<()> {
    registry::remove(config_dir, id)
}

pub fn agents_set_default_inner(config_dir: &PathBuf, id: &str) -> AppResult<()> {
    registry::set_default(config_dir, id)
}

/// ACP 发送准备（组装 + user 落库 + 选默认 agent），随后 spawn run_turn。
/// 流式事件经 `agent://stream|permission|turn` 推前端；取消复用 cancel 通道。
pub fn send_message_acp_start(
    app: &AppHandle,
    s: &AppState,
    session_id: i64,
    instruction: &str,
    opts: &AiTurnOptions,
) -> AppResult<ChatMessage> {
    let (user_msg, desc, prompt_text) = session::send_message_acp_inner(s, session_id, instruction, opts)?;
    start_turn(app, s, session_id, user_msg, desc, prompt_text)
}

/// 阶段 2A：ACP 重新生成。
pub fn regenerate_acp_start(
    app: &AppHandle,
    s: &AppState,
    user_message_id: i64,
    opts: &AiTurnOptions,
) -> AppResult<ChatMessage> {
    let (user_msg, desc, prompt_text) = session::regenerate_acp_inner(s, user_message_id, opts)?;
    let session_id = user_msg.session_id;
    start_turn(app, s, session_id, user_msg, desc, prompt_text)
}

fn start_turn(
    app: &AppHandle,
    s: &AppState,
    session_id: i64,
    user_msg: ChatMessage,
    desc: AgentDescriptor,
    prompt_text: String,
) -> AppResult<ChatMessage> {
    // 会话来源标记
    {
        let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
        crate::repo::sessions::update_source(&conn, session_id, &format!("agent:{}", desc.id))?;
    }
    // 取消信号登记（与 M1 provider 路径同一张表）
    let (tx, rx) = tokio::sync::watch::channel(false);
    s.cancels
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .insert(session_id, tx);
    let app = app.clone();
    let sid = session_id;
    let reply_to = user_msg.id;
    tauri::async_runtime::spawn(async move {
        session::run_turn(app, sid, reply_to, desc, prompt_text, rx).await;
    });
    Ok(user_msg)
}

// ---------- Tauri 薄包装 ----------

#[tauri::command]
pub fn agents_list(s: State<AppState>) -> AppResult<Vec<AgentDescriptor>> {
    agents_list_inner(&s.config_dir())
}

#[tauri::command]
pub async fn agents_probe(s: State<'_, AppState>, id: String) -> AppResult<ProbeResult> {
    agents_probe_inner(&s.config_dir(), &id).await
}

#[tauri::command]
pub fn agents_upsert(s: State<AppState>, desc: AgentDescriptor) -> AppResult<()> {
    agents_upsert_inner(&s.config_dir(), &desc)
}

#[tauri::command]
pub fn agents_remove(s: State<AppState>, id: String) -> AppResult<()> {
    agents_remove_inner(&s.config_dir(), &id)
}

#[tauri::command]
pub fn agents_set_default(s: State<AppState>, id: String) -> AppResult<()> {
    agents_set_default_inner(&s.config_dir(), &id)
}

/// ACP 后端发送：立即落库 user 消息并返回，流式经 agent:// 事件推送。
#[tauri::command]
pub async fn send_message_acp(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: i64,
    instruction: String,
    options: Option<AiTurnOptions>,
) -> AppResult<ChatMessage> {
    send_message_acp_start(&app, &state, session_id, &instruction, &options.unwrap_or_default())
}

/// ACP 后端重新生成（阶段 2A）。
#[tauri::command]
pub async fn chat_regenerate_acp(
    app: AppHandle,
    state: State<'_, AppState>,
    user_message_id: i64,
    options: Option<AiTurnOptions>,
) -> AppResult<ChatMessage> {
    regenerate_acp_start(&app, &state, user_message_id, &options.unwrap_or_default())
}

/// 取消当前 ACP 回合（复用 M1 的取消通道；对未知/已结束会话幂等 Ok）。
#[tauri::command]
pub fn cancel_generation_acp(state: State<AppState>, session_id: i64) -> AppResult<()> {
    let tx = {
        let mut cancels = state.cancels.lock().map_err(|_| AppError::LockPoisoned)?;
        cancels.remove(&session_id)
    };
    if let Some(tx) = tx {
        let _ = tx.send(true);
    }
    Ok(())
}

/// 阶段 2B：撤销某个 agent 回合对书文件的全部改动；已撤销的再调一次 = 恢复
#[tauri::command]
pub fn agent_undo_turn(s: State<AppState>, message_id: i64) -> AppResult<AgentUndoResult> {
    changes::toggle_undo(&s, message_id)
}

/// 前端权限应答：把所选 option_id 送回等待中的后台应答任务。
#[tauri::command]
pub fn agents_respond_permission(
    s: State<AppState>,
    session_id: i64,
    request_id: String,
    option_id: String,
) -> AppResult<()> {
    interaction::respond_permission_inner(&s, session_id, &request_id, &option_id)
}
