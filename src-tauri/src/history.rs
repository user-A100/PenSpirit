//! M2-T7 章节快照版本历史：全文快照 + index.json 滚动索引。
//!
//! 存储：`{book_dir}/.history/{chapter_slug}/{YYYY-MM-DD-HH-mm-ss}_{字数}.md`（全文快照，非 diff）
//! 索引：同目录 `index.json`，`{"list":[{file,ts,words,title}]}` 新→旧，上限 50（超出丢弃最旧）。
//!
//! 章节 slug 取 md 文件名主干（如 `0001-chujian`）。选主干而非标题：md 是唯一真源，
//! DB 重建后按文件名仍能对上历史；代价是重命名章节会另起一份历史（见遗留说明）。
//!
//! `.history/` 为库内隐藏目录——rescan 只读 `{book}/manuscript/`，天然不涉及。
//!
//! 时间戳由调用方传入（取 SQLite `datetime('now','localtime')`，本项目未引入 chrono）：
//! 显式入参让本模块保持纯函数，测试可确定性构造时间序列。

use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::count_words;

/// 快照目录名（书目录下，与 manuscript/.trash 平级）
pub const HISTORY_DIR: &str = ".history";
/// 滚动上限
pub const MAX_SNAPSHOTS: usize = 50;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SnapshotInfo {
    /// 快照文件名（`{stamp}_{字数}.md`）
    pub file: String,
    /// 本地时间 `YYYY-MM-DD HH:MM:SS`
    pub ts: String,
    pub words: i64,
    pub title: String,
}

#[derive(Serialize, Deserialize, Default)]
struct Index {
    #[serde(default)]
    list: Vec<SnapshotInfo>,
}

/// 路径分量安全校验：拒绝空、`.`、`..` 与路径分隔符（slug 来自 DB、file 来自前端）
fn safe_component(s: &str) -> bool {
    !s.is_empty() && s != "." && s != ".." && !s.contains(['/', '\\'])
}

fn snapshot_dir(book_dir: &Path, slug: &str) -> PathBuf {
    book_dir.join(HISTORY_DIR).join(slug)
}

/// 本地时间 `YYYY-MM-DD HH:MM:SS`：借 SQLite localtime，避免为时间格式化引入 chrono
pub fn local_now(conn: &Connection) -> AppResult<String> {
    Ok(conn.query_row("SELECT datetime('now','localtime')", [], |r| r.get(0))?)
}

/// 归一化：统一换行、去行尾空白、压连续空行、去首尾空行。
/// 仅用于「内容是否实质相同」判定，不改变落盘内容。
pub fn normalize(content: &str) -> String {
    let unified = content.replace("\r\n", "\n").replace('\r', "\n");
    let mut lines: Vec<&str> = Vec::new();
    let mut prev_blank = false;
    for line in unified.lines() {
        let t = line.trim_end();
        let blank = t.is_empty();
        if blank && prev_blank {
            continue;
        }
        prev_blank = blank;
        lines.push(t);
    }
    while lines.first().is_some_and(|l| l.is_empty()) {
        lines.remove(0);
    }
    while lines.last().is_some_and(|l| l.is_empty()) {
        lines.pop();
    }
    lines.join("\n")
}

fn read_index(dir: &Path) -> Index {
    fs::read_to_string(dir.join("index.json"))
        .ok()
        .and_then(|s| serde_json::from_str::<Index>(&s).ok())
        .unwrap_or_default()
}

/// 原子写：先写 .tmp 再 rename 覆盖（Windows 上 fs::rename 走 MoveFileEx 可覆盖已有文件）
fn write_index(dir: &Path, idx: &Index) -> AppResult<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join("index.json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(idx).map_err(|e| AppError::Io(e.to_string()))?)?;
    fs::rename(&tmp, dir.join("index.json"))?;
    Ok(())
}

/// 记录一次快照。返回是否真正写入——内容为空、或与最近一次快照实质相同 → false（不重复占位）。
/// IO 失败一律返回 false：历史记录失败不应阻断正文保存。
pub fn snapshot(book_dir: &Path, slug: &str, title: &str, content: &str, ts: &str) -> bool {
    if !safe_component(slug) || content.trim().is_empty() {
        return false;
    }
    let dir = snapshot_dir(book_dir, slug);
    let mut idx = read_index(&dir);

    // 与最近一次快照比对（空白差异不算改动）
    if let Some(latest) = idx.list.first() {
        if let Ok(prev) = fs::read_to_string(dir.join(&latest.file)) {
            if normalize(&prev) == normalize(content) {
                return false;
            }
        }
    }

    let words = count_words(content);
    let stamp = ts.replace(' ', "-").replace(':', "-");
    let mut file = format!("{stamp}_{words}.md");
    let mut n = 2;
    while dir.join(&file).exists() {
        file = format!("{stamp}_{words}-{n}.md");
        n += 1;
    }

    if fs::create_dir_all(&dir).is_err() || fs::write(dir.join(&file), content).is_err() {
        return false;
    }
    idx.list.insert(
        0,
        SnapshotInfo { file, ts: ts.to_string(), words, title: title.to_string() },
    );
    // 滚动：超出上限丢弃最旧（文件与索引条目一起删）
    while idx.list.len() > MAX_SNAPSHOTS {
        if let Some(old) = idx.list.pop() {
            let _ = fs::remove_file(dir.join(&old.file));
        }
    }
    write_index(&dir, &idx).is_ok()
}

/// 快照列表（新→旧）；索引缺失或损坏时返回空
pub fn list_snapshots(book_dir: &Path, slug: &str) -> Vec<SnapshotInfo> {
    if !safe_component(slug) {
        return Vec::new();
    }
    read_index(&snapshot_dir(book_dir, slug)).list
}

/// 读取某次快照全文（`file` 来自前端，做路径分量校验）
pub fn read_snapshot(book_dir: &Path, slug: &str, file: &str) -> AppResult<String> {
    if !safe_component(slug) || !safe_component(file) {
        return Err(AppError::Invalid("非法快照文件名".into()));
    }
    let p = snapshot_dir(book_dir, slug).join(file);
    if !p.exists() {
        return Err(AppError::NotFound(format!("快照不存在: {file}")));
    }
    Ok(fs::read_to_string(p)?)
}
