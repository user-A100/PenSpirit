//! M2-T3 ACP agent 模块：注册表（registry）/ 命令发现（discover）/
//! 短连接探测（probe）。命令层沿用 inner 可测 + `#[tauri::command]`
//! 薄包装模式；`agents_probe` 为 async command（spawn 子进程）。

pub mod discover;
pub mod probe;
pub mod registry;

use std::path::PathBuf;

use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::{AgentDescriptor, ProbeResult};
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
