//! Agent 回合的文件改动追踪与「全部撤销」（阶段 2B）。
//!
//! agent 以书目录为工作目录、直接改磁盘上的文件。回合开始前把书目录里的文本文件读进内存，
//! 结束后再读一遍比对，得出新增 / 修改 / 删除；其中**应用自己造成的**（这段时间里自动保存的正文、
//! 改名重排、移进回收站）排除掉——判据：修改 / 新增后的内容正是应用最近写下的；新增的文件库里已有行；
//! 删除的章文件库里已无在世行。剩下的才算 agent 的改动，存成撤销包（{书}/.history/_agent/{名}.json）。
//!
//! 撤销 = 应用撤销包；应用前先把这些文件的当前内容存成反向包，所以撤销后还能「恢复 AI 改动」。
//! 章文件按**章 id** 记：本应用的文件名带全书序号，从回收站还原等操作会整体重排序号，路径不是稳定身份——
//! 每次落笔前按 id 现查当前路径。删除章一律走回收站（索引一致、可找回），恢复时先从回收站还原。

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Component, Path};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::models::{AgentUndoResult, FileChange};
use crate::repo;
use crate::state::AppState;
use crate::trash;
use crate::util::count_words;

/// 书目录内文本文件：相对路径（正斜杠）→ 内容
pub type Snapshot = BTreeMap<String, String>;

/// 撤销 / 反向包的一项：该把这个文件（或这一章）改成什么样
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PackEntry {
    /// 相对书目录的路径（章文件以 chapter_id 为准，路径只作记录 / 兜底）
    pub path: String,
    #[serde(default)]
    pub chapter_id: Option<i64>,
    /// 该写回的内容；None = 该文件 / 该章不应存在
    pub content: Option<String>,
}
pub type Pack = Vec<PackEntry>;

const MAX_FILE: u64 = 4 * 1024 * 1024;
const PACK_DIR: &str = ".history/_agent";

pub fn snapshot(book_dir: &Path) -> Snapshot {
    let mut out = Snapshot::new();
    walk(book_dir, book_dir, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Snapshot) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // .history / .trash 等隐藏目录不算书的内容
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            walk(root, &path, out);
            continue;
        }
        if !ft.is_file() || (dir == root && name == "book.json") {
            continue;
        }
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if ext != "md" && ext != "txt" {
            continue;
        }
        if entry.metadata().map(|m| m.len() > MAX_FILE).unwrap_or(true) {
            continue;
        }
        if let Ok(text) = fs::read_to_string(&path) {
            out.insert(rel(root, &path), text);
        }
    }
}

fn rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn change(path: &str, kind: &str) -> FileChange {
    FileChange { path: path.to_string(), kind: kind.to_string() }
}

/// 两次快照之差（按路径排序）
pub fn diff(before: &Snapshot, after: &Snapshot) -> Vec<FileChange> {
    let mut out = Vec::new();
    for (k, v) in after {
        match before.get(k) {
            None => out.push(change(k, "added")),
            Some(b) if b != v => out.push(change(k, "modified")),
            _ => {}
        }
    }
    for k in before.keys() {
        if !after.contains_key(k) {
            out.push(change(k, "deleted"));
        }
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

fn safe_rel(p: &str) -> bool {
    !p.is_empty() && Path::new(p).components().all(|c| matches!(c, Component::Normal(_)))
}

fn safe_name(n: &str) -> bool {
    !n.is_empty() && n.ends_with(".json") && !n.starts_with('.') && !n.contains(['/', '\\'])
}

pub fn write_pack(book_dir: &Path, pack: &Pack) -> AppResult<String> {
    let dir = book_dir.join(PACK_DIR);
    fs::create_dir_all(&dir)?;
    let ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let mut name = format!("{ms}.json");
    let mut n = 1;
    while dir.join(&name).exists() {
        name = format!("{ms}-{n}.json");
        n += 1;
    }
    let body = serde_json::to_string(pack).map_err(|e| AppError::Invalid(e.to_string()))?;
    fs::write(dir.join(&name), body)?;
    Ok(name)
}

pub fn read_pack(book_dir: &Path, name: &str) -> AppResult<Pack> {
    if !safe_name(name) {
        return Err(AppError::Invalid("非法撤销包名".into()));
    }
    let text = fs::read_to_string(book_dir.join(PACK_DIR).join(name)).map_err(|_| AppError::NotFound("撤销记录已不存在".into()))?;
    let pack: Pack = serde_json::from_str(&text).map_err(|e| AppError::Invalid(format!("撤销记录损坏：{e}")))?;
    if let Some(bad) = pack.iter().find(|e| !safe_rel(&e.path)) {
        return Err(AppError::Invalid(format!("撤销记录含非法路径：{}", bad.path)));
    }
    Ok(pack)
}

/// 会话所属书：(book_id, slug)
pub fn book_of_session(s: &AppState, chat_session_id: i64) -> AppResult<(i64, String)> {
    let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
    let sess = repo::sessions::get(&conn, chat_session_id)?;
    let book = repo::books::get(&conn, sess.book_id)?;
    Ok((book.id, book.slug))
}

/// 是否章正文文件（manuscript/ 下的 .md，卷首语 _index.md 除外）
fn is_chapter_file(path: &str) -> bool {
    path.starts_with("manuscript/") && path.ends_with(".md") && !path.ends_with(&format!("/{}", fs_service::VOLUME_BODY))
}

fn live_rows(s: &AppState, book_id: i64) -> Vec<crate::models::ChapterMeta> {
    s.db.lock().ok().and_then(|c| repo::chapters::list_nodes(&c, book_id).ok()).unwrap_or_default()
}

/// 从比对结果里去掉应用自己造成的改动，剩下的算 agent 的
pub fn agent_changes(s: &AppState, book_id: i64, slug: &str, before: &Snapshot, after: &Snapshot) -> Vec<FileChange> {
    let live: HashSet<String> = live_rows(s, book_id).into_iter().map(|r| r.file_path).collect();
    diff(before, after)
        .into_iter()
        .filter(|c| {
            let full = format!("{slug}/{}", c.path);
            match c.kind.as_str() {
                "modified" => !s.app_wrote(&full, &after[&c.path]),
                "added" => !live.contains(&full) && !s.app_wrote(&full, &after[&c.path]),
                // 应用的改名 / 移进回收站会同步改库；库里仍指着它的才是 agent 删的
                _ => !is_chapter_file(&c.path) || live.contains(&full),
            }
        })
        .collect()
}

/// 磁盘改动后同步索引：在世章更新字数；库里没有的新章文件 → 重扫建行
pub fn sync_index(s: &AppState, book_id: i64, slug: &str, changes: &[FileChange]) -> AppResult<()> {
    let nodes = live_rows(s, book_id);
    let mut rescan = false;
    for c in changes.iter().filter(|c| is_chapter_file(&c.path) && c.kind != "deleted") {
        let full = format!("{slug}/{}", c.path);
        match nodes.iter().find(|n| n.file_path == full) {
            Some(n) => {
                let text = fs_service::read_chapter(&s.root, &full).unwrap_or_default();
                let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
                repo::chapters::touch_content(&conn, n.id, count_words(&text))?;
            }
            None => rescan = true,
        }
    }
    if rescan {
        crate::commands::rescan_library_inner(s)?;
    }
    Ok(())
}

/// 回合结束：得出 agent 的改动；有改动则同步索引并存撤销包。返回（改动, 撤销包名）
pub fn finish_turn(s: &AppState, book_id: i64, slug: &str, before: &Snapshot) -> (Vec<FileChange>, Option<String>) {
    let book_dir = s.root.join(slug);
    let after = snapshot(&book_dir);
    let changes = agent_changes(s, book_id, slug, before, &after);
    if changes.is_empty() {
        return (changes, None);
    }
    if let Err(e) = sync_index(s, book_id, slug, &changes) {
        eprintln!("agent 改动后同步索引失败: {e}");
    }
    // 同步后新章也有了行：章文件一律记下章 id
    let rows = live_rows(s, book_id);
    let pack: Pack = changes
        .iter()
        .map(|c| PackEntry {
            path: c.path.clone(),
            chapter_id: is_chapter_file(&c.path).then(|| rows.iter().find(|r| r.file_path == format!("{slug}/{}", c.path)).map(|r| r.id)).flatten(),
            content: before.get(&c.path).cloned(),
        })
        .collect();
    let undo = write_pack(&book_dir, &pack).map_err(|e| eprintln!("存 agent 撤销包失败: {e}")).ok();
    (changes, undo)
}

/// 一项当前的位置与内容：章按 id 现查（在回收站里 = 不存在）；查不到 id 的按路径
fn current(s: &AppState, book_dir: &Path, slug: &str, e: &PackEntry) -> AppResult<(String, Option<String>)> {
    if let Some(id) = e.chapter_id {
        let row = {
            let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
            repo::chapters::get(&conn, id).ok()
        };
        if let Some(row) = row {
            if row.deleted_at.is_some() {
                return Ok((e.path.clone(), None));
            }
            let path = row.file_path.strip_prefix(&format!("{slug}/")).unwrap_or(&row.file_path).to_string();
            let content = fs::read_to_string(book_dir.join(&path)).ok();
            return Ok((path, content));
        }
    }
    Ok((e.path.clone(), fs::read_to_string(book_dir.join(&e.path)).ok()))
}

/// 撤销某条 agent 回答对应回合的全部文件改动；已撤销的再调一次 = 恢复 AI 改动。
pub fn toggle_undo(s: &AppState, message_id: i64) -> AppResult<AgentUndoResult> {
    let (meta_raw, book_id, slug) = {
        let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
        let m = repo::sessions::get_message(&conn, message_id)?;
        let sess = repo::sessions::get(&conn, m.session_id)?;
        let book = repo::books::get(&conn, sess.book_id)?;
        (m.meta, book.id, book.slug)
    };
    let mut meta: serde_json::Value = serde_json::from_str(&meta_raw).unwrap_or_else(|_| serde_json::json!({}));
    let undone = meta.get("undone").and_then(|v| v.as_bool()).unwrap_or(false);
    let key = if undone { "redo" } else { "undo" };
    let name = meta
        .get(key)
        .and_then(|v| v.as_str())
        .ok_or_else(|| AppError::Invalid("这一回合没有可撤销的文件改动".into()))?
        .to_string();
    let book_dir = s.root.join(&slug);
    let pack = read_pack(&book_dir, &name)?;

    // 1) 先存反向包（各项当前的样子），再动文件
    let mut inverse = Pack::new();
    for e in &pack {
        let (path, content) = current(s, &book_dir, &slug, e)?;
        inverse.push(PackEntry { path, chapter_id: e.chapter_id, content });
    }
    let inverse_name = write_pack(&book_dir, &inverse)?;

    // 2) 要「存在」的章若在回收站里，先还原（还原会重排全书文件序号——所以后面一律按 id 现查路径）
    for e in pack.iter().filter(|e| e.content.is_some()) {
        let Some(id) = e.chapter_id else { continue };
        let deleted = {
            let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
            repo::chapters::get(&conn, id).ok().map(|r| r.deleted_at.is_some()).unwrap_or(false)
        };
        if deleted {
            trash::restore_chapter_inner(s, id)?;
        }
    }

    // 3) 逐项落实
    let mut applied = Vec::new();
    for e in &pack {
        let (path, existing) = current(s, &book_dir, &slug, e)?;
        let live_chapter = e.chapter_id.filter(|id| {
            s.db.lock().ok().and_then(|c| repo::chapters::get(&c, *id).ok()).map(|r| r.deleted_at.is_none()).unwrap_or(false)
        });
        match &e.content {
            None => match live_chapter {
                Some(id) => {
                    trash::soft_delete_chapter_inner(s, id)?;
                    applied.push(change(&path, "deleted"));
                }
                None if existing.is_some() => {
                    fs::remove_file(book_dir.join(&path))?;
                    applied.push(change(&path, "deleted"));
                }
                None => {}
            },
            Some(text) => {
                let abs = book_dir.join(&path);
                if let Some(dir) = abs.parent() {
                    fs::create_dir_all(dir)?;
                }
                fs::write(&abs, text)?;
                applied.push(change(&path, if existing.is_some() || live_chapter.is_some() { "modified" } else { "added" }));
            }
        }
    }
    sync_index(s, book_id, &slug, &applied)?;
    meta[if undone { "undo" } else { "redo" }] = serde_json::json!(inverse_name);
    meta["undone"] = serde_json::json!(!undone);
    {
        let conn = s.db.lock().map_err(|_| AppError::LockPoisoned)?;
        repo::sessions::set_meta(&conn, message_id, &meta.to_string())?;
    }
    Ok(AgentUndoResult { undone: !undone, changes: applied })
}
