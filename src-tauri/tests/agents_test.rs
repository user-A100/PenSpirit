//! M2-T3：ACP agent 注册表 / 命令发现 / 短连接探测。

use std::path::{Path, PathBuf};

use bixian::agents::{discover, probe, registry};
use bixian::error::AppError;
use bixian::models::AgentDescriptor;

fn tmp_config() -> (tempfile::TempDir, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("config");
    std::fs::create_dir_all(&dir).unwrap();
    (tmp, dir)
}

fn custom(id: &str, command: &str) -> AgentDescriptor {
    AgentDescriptor {
        id: id.into(),
        name: format!("自定义 {id}"),
        command: command.into(),
        args: vec![],
        enabled: true,
        is_default: false,
        last_probe: None,
    }
}

// ---------- 内置模板与首次初始化 ----------

#[test]
fn list_initializes_templates_when_file_missing() {
    let (_tmp, dir) = tmp_config();
    assert!(!dir.join("agents.json").exists());
    let agents = registry::list(&dir).unwrap();
    assert_eq!(agents.len(), 3);
    assert_eq!(agents[0].id, "claude");
    assert_eq!(agents[0].command, "claude-agent-acp");
    assert!(agents[0].args.is_empty());
    assert!(agents[0].enabled);
    assert!(agents[0].is_default); // 首个模板 claude 为默认
    assert_eq!(agents[0].last_probe, None);
    assert_eq!(agents[1].id, "codex");
    assert_eq!(agents[1].command, "codex-acp");
    assert!(!agents[1].is_default);
    assert_eq!(agents[2].id, "gemini");
    assert_eq!(agents[2].command, "gemini");
    assert_eq!(agents[2].args, vec!["--acp".to_string(), "--skip-trust".to_string()]);
    // 初始化后文件已落盘，且不留 .tmp 残留（原子写）
    assert!(dir.join("agents.json").exists());
    assert!(!dir.join("agents.json.tmp").exists());
}

#[test]
fn list_is_stable_across_calls() {
    let (_tmp, dir) = tmp_config();
    let a = registry::list(&dir).unwrap();
    let b = registry::list(&dir).unwrap();
    assert_eq!(a, b);
}

// ---------- CRUD ----------

#[test]
fn upsert_new_custom_agent_and_json_roundtrip() {
    let (_tmp, dir) = tmp_config();
    let desc = custom("custom:kimi", "kimi-code-acp");
    registry::upsert(&dir, &desc).unwrap();
    let agents = registry::list(&dir).unwrap();
    assert_eq!(agents.len(), 4);
    let saved = agents.iter().find(|a| a.id == "custom:kimi").unwrap();
    assert_eq!(saved.command, "kimi-code-acp");

    // JSON 往返：直接从磁盘反序列化字段一致（snake_case）
    let raw = std::fs::read_to_string(dir.join("agents.json")).unwrap();
    let parsed: Vec<AgentDescriptor> = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed.len(), 4);
    assert!(parsed.iter().any(|a| a.id == "custom:kimi" && a.command == "kimi-code-acp"));
}

#[test]
fn upsert_existing_updates_and_preserves_last_probe() {
    let (_tmp, dir) = tmp_config();
    let mut desc = custom("custom:kimi", "kimi-code-acp");
    desc.last_probe = Some(bixian::models::ProbeResult {
        ok: true,
        agent_name: Some("Kimi".into()),
        protocol_version: Some("v1".into()),
        can_resume: false,
        detail: None,
    });
    registry::upsert(&dir, &desc).unwrap();
    // 前端编辑命令时不带 last_probe → 不应清掉历史探测结果
    let edited = custom("custom:kimi", "kimi-code-acp-v2");
    registry::upsert(&dir, &edited).unwrap();
    let agents = registry::list(&dir).unwrap();
    let saved = agents.iter().find(|a| a.id == "custom:kimi").unwrap();
    assert_eq!(saved.command, "kimi-code-acp-v2");
    let lp = saved.last_probe.as_ref().unwrap();
    assert!(lp.ok);
    assert_eq!(lp.agent_name.as_deref(), Some("Kimi"));
}

#[test]
fn upsert_default_clears_others() {
    let (_tmp, dir) = tmp_config();
    let mut desc = custom("custom:kimi", "kimi-code-acp");
    desc.is_default = true;
    registry::upsert(&dir, &desc).unwrap();
    let agents = registry::list(&dir).unwrap();
    let defaults: Vec<_> = agents.iter().filter(|a| a.is_default).collect();
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].id, "custom:kimi");
}

#[test]
fn set_default_switches_exactly_one() {
    let (_tmp, dir) = tmp_config();
    registry::set_default(&dir, "gemini").unwrap();
    let agents = registry::list(&dir).unwrap();
    let defaults: Vec<_> = agents.iter().filter(|a| a.is_default).collect();
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].id, "gemini");
}

#[test]
fn set_default_unknown_id_is_not_found() {
    let (_tmp, dir) = tmp_config();
    let err = registry::set_default(&dir, "nope").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");
}

#[test]
fn remove_unknown_id_is_not_found() {
    let (_tmp, dir) = tmp_config();
    let err = registry::remove(&dir, "nope").unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");
}

#[test]
fn remove_default_reassigns_first_remaining() {
    let (_tmp, dir) = tmp_config();
    registry::remove(&dir, "claude").unwrap(); // claude 是默认
    let agents = registry::list(&dir).unwrap();
    assert_eq!(agents.len(), 2);
    let defaults: Vec<_> = agents.iter().filter(|a| a.is_default).collect();
    assert_eq!(defaults.len(), 1);
    assert_eq!(defaults[0].id, "codex"); // 剩余首个顶上
}

#[test]
fn atomic_write_leaves_no_tmp_file() {
    let (_tmp, dir) = tmp_config();
    registry::upsert(&dir, &custom("custom:a", "cmd-a")).unwrap();
    registry::upsert(&dir, &custom("custom:b", "cmd-b")).unwrap();
    registry::set_default(&dir, "codex").unwrap();
    assert!(!dir.join("agents.json.tmp").exists());
    assert_eq!(registry::list(&dir).unwrap().len(), 5);
}

// ---------- 命令发现 ----------

#[test]
fn resolve_command_missing_returns_none() {
    assert!(discover::resolve_command("definitely-not-exists-cmd-xyz").is_none());
}

#[test]
fn resolve_command_absolute_path_branch() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("some-tool.cmd");
    std::fs::write(&file, "@echo off\r\n").unwrap();
    let s = file.to_string_lossy().to_string();
    assert!(discover::resolve_command(&s).is_some());
    let missing = tmp.path().join("missing.cmd").to_string_lossy().to_string();
    assert!(discover::resolve_command(&missing).is_none());
}

#[cfg(windows)]
#[test]
fn pathext_probe_prefers_exe_over_cmd_over_bat() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path();
    // 仅 .bat
    std::fs::write(dir.join("tool-x.bat"), "@echo off\r\n").unwrap();
    assert_eq!(
        discover::probe_pathext_in_dir(dir, "tool-x").unwrap(),
        dir.join("tool-x.bat")
    );
    // 加入 .cmd → .cmd 优先于 .bat
    std::fs::write(dir.join("tool-x.cmd"), "@echo off\r\n").unwrap();
    assert_eq!(
        discover::probe_pathext_in_dir(dir, "tool-x").unwrap(),
        dir.join("tool-x.cmd")
    );
    // 加入带 PE 头的 .exe → .exe 最优先
    let mut exe = vec![b'M', b'Z'];
    exe.extend_from_slice(b"\x00".repeat(64).as_slice());
    std::fs::write(dir.join("tool-x.exe"), &exe).unwrap();
    assert_eq!(
        discover::probe_pathext_in_dir(dir, "tool-x").unwrap(),
        dir.join("tool-x.exe")
    );
    // 无扩展名垫片（npm sh 脚本）不可作为 Windows 可执行入口
    std::fs::write(dir.join("tool-y"), "#!/bin/sh\n").unwrap();
    assert!(discover::probe_pathext_in_dir(dir, "tool-y").is_none());
}

#[cfg(windows)]
#[test]
fn pathext_probe_missing_name_is_none() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(discover::probe_pathext_in_dir(tmp.path(), "nothing-here").is_none());
}

// ---------- 探测：失败路径（不依赖本机安装） ----------

#[tokio::test]
async fn probe_missing_command_is_fail_not_panic() {
    let desc = custom("custom:ghost", "definitely-not-exists-cmd-xyz");
    let r = probe::probe(&desc).await;
    assert!(!r.ok);
    assert!(r.agent_name.is_none());
    assert!(r.protocol_version.is_none());
    assert!(!r.can_resume);
    let detail = r.detail.expect("失败时应给出原因");
    assert!(detail.contains("definitely-not-exists-cmd-xyz"), "detail: {detail}");
}

#[tokio::test]
async fn probe_inner_writes_back_last_probe() {
    let (_tmp, dir) = tmp_config();
    registry::upsert(&dir, &custom("custom:ghost", "definitely-not-exists-cmd-xyz")).unwrap();
    let r = bixian::agents::agents_probe_inner(&dir, "custom:ghost").await.unwrap();
    assert!(!r.ok);
    // 探测结果回写 agents.json
    let agents = registry::list(&dir).unwrap();
    let saved = agents.iter().find(|a| a.id == "custom:ghost").unwrap();
    let lp = saved.last_probe.as_ref().expect("last_probe 应已回写");
    assert!(!lp.ok);
    assert!(lp.detail.is_some());
}

#[tokio::test]
async fn probe_inner_unknown_id_is_not_found() {
    let (_tmp, dir) = tmp_config();
    let err = bixian::agents::agents_probe_inner(&dir, "nope").await.unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");
}

// ---------- 活体探测（手动） ----------
// 设置 BIXIAN_AGENT_CMD（如 claude-agent-acp）后运行：
//   cargo test --manifest-path src-tauri/Cargo.toml --test agents_test live_probe -- --ignored --nocapture
// 可选 BIXIAN_AGENT_ARGS 传参（如 gemini 的 "--acp --skip-trust"）。

#[tokio::test]
#[ignore = "活体探测：需本机安装 ACP agent，设置 BIXIAN_AGENT_CMD 后运行"]
async fn live_probe() {
    let Ok(cmd) = std::env::var("BIXIAN_AGENT_CMD") else {
        eprintln!("跳过：未设置 BIXIAN_AGENT_CMD");
        return;
    };
    let args = std::env::var("BIXIAN_AGENT_ARGS")
        .unwrap_or_default()
        .split_whitespace()
        .map(String::from)
        .collect::<Vec<_>>();
    let desc = AgentDescriptor {
        id: "live".into(),
        name: "活体探测".into(),
        command: cmd,
        args,
        enabled: true,
        is_default: false,
        last_probe: None,
    };
    let r = probe::probe(&desc).await;
    assert!(r.ok, "探测失败: {:?}", r.detail);
    let name = r.agent_name.expect("活体探测应返回 agent 名称");
    assert!(!name.is_empty());
    let version = r.protocol_version.expect("活体探测应返回协议版本");
    assert!(version.starts_with('v'), "版本格式: {version}");
}

// 抑制未使用警告（Path 供 cfg(windows) 之外的分支共用）
#[allow(dead_code)]
fn _touch(_: &Path) {}
