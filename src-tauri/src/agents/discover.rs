//! 命令发现：GUI 进程的 PATH 常与终端不同，
//! 需在 `which` 之外补探常见安装目录（Windows：%APPDATA%\npm）。
//!
//! Windows 上 `npm i -g` 会同时落一个无扩展名的 sh 垫脚（供 Git Bash 用）
//! 和 `.cmd`/`.exe` 入口；无扩展名文件无法被 CreateProcess 执行，
//! 因此按 PATHEXT 顺序（exe→cmd→bat）探测真实入口。

use std::io::Read;
use std::path::{Path, PathBuf};

/// 解析命令名到可执行文件绝对路径。
///
/// 顺序：含路径分隔符/绝对路径直接校验 → `which`（当前 PATH）→
/// Windows 失败则补探 `%APPDATA%\npm\{name}.{exe|cmd|bat}`。
pub fn resolve_command(name: &str) -> Option<PathBuf> {
    let p = Path::new(name);
    if p.is_absolute() || name.contains('/') || name.contains('\\') {
        return if is_spawnable(p) { Some(p.to_path_buf()) } else { None };
    }
    if let Ok(found) = which::which(name) {
        if is_spawnable(&found) {
            return Some(found);
        }
        // Windows 上 which 可能命中无扩展名 sh 垫脚：落回 npm 目录补探
    }
    #[cfg(windows)]
    {
        if let Some(p) = npm_fallback(name) {
            return Some(p);
        }
    }
    None
}

/// Windows：npm 全局 bin 目录补探。
#[cfg(windows)]
fn npm_fallback(name: &str) -> Option<PathBuf> {
    let appdata = std::env::var("APPDATA").ok()?;
    probe_pathext_in_dir(Path::new(&appdata).join("npm").as_path(), name)
}

/// 在指定目录内按 PATHEXT 顺序（exe→cmd→bat）探测命令入口。
/// 纯函数，供测试与 npm_fallback 共用。
#[cfg(windows)]
pub fn probe_pathext_in_dir(dir: &Path, name: &str) -> Option<PathBuf> {
    for ext in ["exe", "cmd", "bat"] {
        let cand = dir.join(format!("{name}.{ext}"));
        if is_spawnable(&cand) {
            return Some(cand);
        }
    }
    None
}

/// 文件是否可作为子进程入口直接 spawn。
#[cfg(windows)]
fn is_spawnable(p: &Path) -> bool {
    if !p.is_file() {
        return false;
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("cmd") | Some("bat") => true,
        Some("exe") => has_pe_magic(p),
        // 无扩展名（npm sh 垫脚等）不可执行
        _ => false,
    }
}

/// 校验 PE 头（MZ），防止文本文件改名 .exe 触发系统误导性弹窗。
#[cfg(windows)]
fn has_pe_magic(p: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(p) else {
        return false;
    };
    let mut magic = [0_u8; 2];
    file.read_exact(&mut magic).is_ok() && magic == *b"MZ"
}

#[cfg(not(windows))]
fn is_spawnable(p: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    if !p.is_file() {
        return false;
    }
    p.metadata()
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}
