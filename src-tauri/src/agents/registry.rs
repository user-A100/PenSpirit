//! ACP agent 注册表：内置模板 + `agents.json` 持久化（原子写）。
//!
//! 存储位置为配置目录（%APPDATA%/com.bixian.app，与 library 平级）下的
//! `agents.json`。首次 `list` 时若文件不存在则从内置模板初始化。

use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::AgentDescriptor;

/// agents.json 文件路径。
pub fn agents_json_path(config_dir: &Path) -> PathBuf {
    config_dir.join("agents.json")
}

/// 内置模板（探测命令/ACP 命令来自调研映射表）：
/// claude → claude-agent-acp 无参；codex → codex-acp 无参；
/// gemini → gemini --acp --skip-trust；custom 由用户填写。
pub fn builtin_templates() -> Vec<AgentDescriptor> {
    vec![
        AgentDescriptor {
            id: "claude".into(),
            name: "Claude Code".into(),
            command: "claude-agent-acp".into(),
            args: vec![],
            enabled: true,
            is_default: true, // 首个模板为默认
            last_probe: None,
        },
        AgentDescriptor {
            id: "codex".into(),
            name: "Codex".into(),
            command: "codex-acp".into(),
            args: vec![],
            enabled: true,
            is_default: false,
            last_probe: None,
        },
        AgentDescriptor {
            id: "gemini".into(),
            name: "Gemini".into(),
            command: "gemini".into(),
            args: vec!["--acp".into(), "--skip-trust".into()],
            enabled: true,
            is_default: false,
            last_probe: None,
        },
    ]
}

/// 原子写：先写 `.tmp` 再 rename 覆盖
/// （Windows 上 `std::fs::rename` 内部为 MOVEFILE_REPLACE_EXISTING，可覆盖）。
fn write_atomic(config_dir: &Path, agents: &[AgentDescriptor]) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let path = agents_json_path(config_dir);
    let tmp = config_dir.join("agents.json.tmp");
    let json = serde_json::to_string_pretty(agents)
        .map_err(|e| AppError::Invalid(format!("agents.json 序列化失败: {e}")))?;
    fs::write(&tmp, json)?;
    fs::rename(&tmp, &path)?;
    Ok(())
}

/// 维持「恰好一个默认」不变量：无默认时取首个补位。
fn ensure_single_default(agents: &mut [AgentDescriptor]) {
    if !agents.is_empty() && !agents.iter().any(|a| a.is_default) {
        agents[0].is_default = true;
    }
}

/// 读取 agent 列表；文件不存在（或为空）时从模板初始化并落盘。
pub fn list(config_dir: &Path) -> AppResult<Vec<AgentDescriptor>> {
    let path = agents_json_path(config_dir);
    if !path.exists() {
        let templates = builtin_templates();
        write_atomic(config_dir, &templates)?;
        return Ok(templates);
    }
    let raw = fs::read_to_string(&path)?;
    if raw.trim().is_empty() {
        // 损坏/空文件：重新从模板初始化，避免用户被卡死
        let templates = builtin_templates();
        write_atomic(config_dir, &templates)?;
        return Ok(templates);
    }
    serde_json::from_str(&raw).map_err(|e| AppError::Invalid(format!("agents.json 解析失败: {e}")))
}

/// 按 id 新增或更新。更新时若调用方未携带 last_probe（前端编辑场景），
/// 保留历史探测结果；置为默认会清掉其他 agent 的默认位。
pub fn upsert(config_dir: &Path, desc: &AgentDescriptor) -> AppResult<()> {
    let mut agents = list(config_dir)?;
    match agents.iter_mut().find(|a| a.id == desc.id) {
        Some(existing) => {
            let mut next = desc.clone();
            if next.last_probe.is_none() {
                next.last_probe = existing.last_probe.clone();
            }
            *existing = next;
        }
        None => agents.push(desc.clone()),
    }
    if desc.is_default {
        for a in agents.iter_mut() {
            if a.id != desc.id {
                a.is_default = false;
            }
        }
    }
    ensure_single_default(&mut agents);
    write_atomic(config_dir, &agents)
}

/// 按 id 移除；移除默认项后由剩余首个顶上。未知 id 返回 NotFound。
pub fn remove(config_dir: &Path, id: &str) -> AppResult<()> {
    let mut agents = list(config_dir)?;
    let before = agents.len();
    agents.retain(|a| a.id != id);
    if agents.len() == before {
        return Err(AppError::NotFound(format!("agent 不存在: {id}")));
    }
    ensure_single_default(&mut agents);
    write_atomic(config_dir, &agents)
}

/// 设置默认 agent（唯一默认位）。未知 id 返回 NotFound。
pub fn set_default(config_dir: &Path, id: &str) -> AppResult<()> {
    let mut agents = list(config_dir)?;
    if !agents.iter().any(|a| a.id == id) {
        return Err(AppError::NotFound(format!("agent 不存在: {id}")));
    }
    for a in agents.iter_mut() {
        a.is_default = a.id == id;
    }
    write_atomic(config_dir, &agents)
}
