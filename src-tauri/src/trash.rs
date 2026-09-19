//! M2-T6 回收站：md 文件唯一真源下的软删除。
//!
//! 删除章 = md 移到 `{book_dir}/.trash/{原文件名}`（冲突加 -N 后缀）+ 行标 deleted_at/orig_file_path
//! （file_path 此时指向 .trash 内位置，read_chapter 仍可读回收站内容）。
//! 删除书 = 整书目录移 `{root}/.trash_books/{slug}` + 行标 deleted_at/orig_dir_name
//! （slug 此时指向 .trash_books 内位置，避免与新书 slug 的 UNIQUE 冲突）。
//! 恢复 = 移回原位 + 清字段；彻底删除 = 删文件/目录 + 删行（书级行删除经 FK 级联删章行）。

use std::fs;
use std::path::Path;

use crate::commands::lock;
use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::models::{Book, ChapterMeta};
use crate::repo;
use crate::state::AppState;

/// 书级回收站目录（root 下）
pub const BOOK_TRASH_DIR: &str = ".trash_books";
/// 章级回收站目录（书目录下，与 manuscript 平级，扫描天然不涉及）
pub const CHAPTER_TRASH_DIR: &str = ".trash";

/// 目标相对路径被占用时加 -N 后缀（保留扩展名）：a.md → a-2.md、目录名 → 目录名-2。
/// slug 不含点号，目录名按无扩展名整体加后缀即可安全复用同一逻辑。
fn unique_rel(root: &Path, rel: &str) -> String {
    if !root.join(rel).exists() {
        return rel.to_string();
    }
    let p = Path::new(rel);
    let parent = p.parent().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    let stem = p.file_stem().map(|x| x.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 2.. {
        let name = format!("{stem}-{n}{ext}");
        let cand = if parent.is_empty() { name } else { format!("{parent}/{name}") };
        if !root.join(&cand).exists() {
            return cand;
        }
    }
    unreachable!()
}

// ---- 章级 ----

/// 删除章（软删）：文件移入 {book}/.trash/，行标记回收站状态。幂等：已在回收站的章直接成功。
pub fn soft_delete_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    let (ch, book) = {
        let conn = lock(s)?;
        let ch = repo::chapters::get(&*conn, id)?;
        let book = repo::books::get(&*conn, ch.book_id)?;
        (ch, book)
    };
    if ch.deleted_at.is_some() {
        return Ok(());
    }
    if book.deleted_at.is_some() {
        return Err(AppError::Invalid("书籍已在回收站中，请先恢复书籍".into()));
    }
    let file_name = ch.file_path.rsplit('/').next().unwrap_or(&ch.file_path).to_string();
    let trash_rel = unique_rel(&s.root, &format!("{}/{}/{}", book.slug, CHAPTER_TRASH_DIR, file_name));
    let from = s.root.join(&ch.file_path);
    if !from.exists() {
        return Err(AppError::NotFound(format!("章节文件不存在: {}", ch.file_path)));
    }
    let to = s.root.join(&trash_rel);
    if let Some(p) = to.parent() {
        fs::create_dir_all(p)?;
    }
    fs::rename(&from, &to)?;
    lock(s).and_then(|conn| repo::chapters::soft_delete(&*conn, id, &trash_rel, &ch.file_path))
}

/// 当前书回收站列表（删除时间倒序）
pub fn list_trash_inner(s: &AppState, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    repo::chapters::list_deleted_by_book(&*lock(s)?, book_id)
}

/// 恢复章：文件移回 orig_file_path（父目录确保存在），清软删标记。
/// 目标位已有同名文件时报错（不静默覆盖）。
pub fn restore_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    let ch = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?;
    let orig = ch
        .orig_file_path
        .clone()
        .ok_or_else(|| AppError::Invalid("章节不在回收站中".into()))?;
    let from = s.root.join(&ch.file_path);
    let to = s.root.join(&orig);
    if !from.exists() {
        return Err(AppError::NotFound("回收站文件不存在".into()));
    }
    if to.exists() {
        return Err(AppError::Invalid(format!("目标位置已有同名文件: {orig}")));
    }
    if let Some(p) = to.parent() {
        fs::create_dir_all(p)?;
    }
    fs::rename(&from, &to)?;
    lock(s).and_then(|conn| repo::chapters::restore(&*conn, id, &orig))
}

/// 彻底删除章：删 .trash 文件 + 删行
pub fn purge_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    let ch = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?;
    if ch.orig_file_path.is_none() {
        return Err(AppError::Invalid("章节不在回收站中".into()));
    }
    let p = s.root.join(&ch.file_path);
    if p.exists() {
        fs::remove_file(&p)?;
    }
    lock(s).and_then(|conn| repo::chapters::delete(&*conn, id))
}

/// 清空当前书回收站：逐章彻底删除
pub fn empty_trash_inner(s: &AppState, book_id: i64) -> AppResult<()> {
    let ids: Vec<i64> = lock(s)
        .and_then(|conn| repo::chapters::list_deleted_by_book(&*conn, book_id))?
        .into_iter()
        .map(|c| c.id)
        .collect();
    for id in ids {
        purge_chapter_inner(s, id)?;
    }
    Ok(())
}

// ---- 书级 ----

/// 删除书（软删）：整书目录移入 {root}/.trash_books/{slug}（冲突加 -N 后缀），
/// 行标 deleted_at/orig_dir_name 且 slug 改指回收站位置（腾出原目录名，避免新书 UNIQUE 冲突）。
/// 幂等：已在回收站的书直接成功。
pub fn soft_delete_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    let book = lock(s).and_then(|conn| repo::books::get(&*conn, id))?;
    if book.deleted_at.is_some() {
        return Ok(());
    }
    let from = s.root.join(&book.slug);
    if !from.exists() {
        return Err(AppError::NotFound(format!("书籍目录不存在: {}", book.slug)));
    }
    let trash_slug = unique_rel(&s.root, &format!("{}/{}", BOOK_TRASH_DIR, book.slug));
    let to = s.root.join(&trash_slug);
    if let Some(p) = to.parent() {
        fs::create_dir_all(p)?;
    }
    fs::rename(&from, &to)?;
    // 章行 file_path 不动（仍指原书目录下路径）：书在回收站期间不可见，
    // 恢复时目录归位即重新生效；若恢复到 -N 新名则统一重写前缀（见 restore_book_inner）。
    lock(s).and_then(|conn| repo::books::soft_delete(&*conn, id, &trash_slug, &book.slug))
}

/// 书回收站列表（删除时间倒序）
pub fn list_trash_books_inner(s: &AppState) -> AppResult<Vec<Book>> {
    repo::books::list_deleted(&*lock(s)?)
}

/// 恢复书：目录移回 root/{orig_dir_name} + 清字段。
/// 原目录名被占用（删后又建了同名书）时恢复到 -N 新目录名，
/// 并把该书全部章行 file_path 前缀（含 .trash 内软删章）重写到新前缀。
/// 书恢复 ≠ 章全部复活：其内 .trash 子目录里被软删的章保持软删状态。
pub fn restore_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    let book = lock(s).and_then(|conn| repo::books::get(&*conn, id))?;
    let orig_dir = book
        .orig_dir_name
        .clone()
        .ok_or_else(|| AppError::Invalid("书籍不在回收站中".into()))?;
    let from = s.root.join(&book.slug);
    if !from.exists() {
        return Err(AppError::NotFound("回收站目录不存在".into()));
    }
    let dest_slug = if s.root.join(&orig_dir).exists() {
        fs_service::unique_slug(&s.root, &orig_dir)
    } else {
        orig_dir.clone()
    };
    fs::rename(&from, s.root.join(&dest_slug))?;
    let conn = lock(s)?;
    if dest_slug != orig_dir {
        repo::chapters::rebase_book_prefix(&*conn, id, &orig_dir, &dest_slug)?;
    }
    repo::books::restore(&*conn, id, &dest_slug)
}

/// 彻底删除书：删 .trash_books 下目录 + 删书行（章行经 FK 级联删除，含其中的软删章）
pub fn purge_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    let book = lock(s).and_then(|conn| repo::books::get(&*conn, id))?;
    if book.orig_dir_name.is_none() {
        return Err(AppError::Invalid("书籍不在回收站中".into()));
    }
    let p = s.root.join(&book.slug);
    if p.exists() {
        fs::remove_dir_all(&p)?;
    }
    lock(s).and_then(|conn| repo::books::delete(&*conn, id))
}
