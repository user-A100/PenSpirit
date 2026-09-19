use tauri::State;

use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::models::{Book, ChapterContent, ChapterMeta};
use crate::repo;
use crate::state::AppState;
use crate::trash;
use crate::util::count_words;

pub(crate) fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    s.db.lock().map_err(|_| AppError::LockPoisoned)
}

pub fn list_books_inner(s: &AppState) -> AppResult<Vec<Book>> {
    repo::books::list(&*lock(s)?)
}

pub fn create_book_inner(s: &AppState, title: &str) -> AppResult<Book> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("书名不能为空".into()));
    }
    let slug = {
        // 持锁计算 unique_slug，避免并发建书时目录名竞争
        let _guard = lock(s)?;
        fs_service::unique_slug(&s.root, &fs_service::slugify(title))
    };
    fs_service::create_book_dir(&s.root, &slug, title)?;
    let book = lock(s).and_then(|conn| repo::books::create(&*conn, title, &slug))?;
    Ok(book)
}

/// 删除书 = 软删：目录移入 .trash_books/，行标 deleted_at（M2-T6）
pub fn delete_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    trash::soft_delete_book_inner(s, id)
}

pub fn list_chapters_inner(s: &AppState, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    repo::chapters::list_by_book(&*lock(s)?, book_id)
}

pub fn create_chapter_inner(s: &AppState, book_id: i64, title: &str) -> AppResult<ChapterMeta> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("章节标题不能为空".into()));
    }
    let (slug, index) = {
        let conn = lock(s)?;
        let book = repo::books::get(&*conn, book_id)?;
        (book.slug, repo::chapters::next_index(&*conn, book_id)?)
    };
    let rel = fs_service::chapter_rel_path(&slug, index, title);
    fs_service::write_chapter(&s.root, &rel, "")?;
    lock(s).and_then(|conn| repo::chapters::create(&*conn, book_id, &rel, title))
}

pub fn rename_chapter_inner(s: &AppState, id: i64, new_title: &str) -> AppResult<ChapterMeta> {
    let new_title = new_title.trim();
    if new_title.is_empty() {
        return Err(AppError::Invalid("章节标题不能为空".into()));
    }
    let (old_rel, new_rel) = {
        let conn = lock(s)?;
        let ch = repo::chapters::get(&*conn, id)?;
        let book = repo::books::get(&*conn, ch.book_id)?;
        let index = ch
            .file_path
            .rsplit('/')
            .next()
            .unwrap()
            .split('-')
            .next()
            .unwrap()
            .parse::<i64>()
            .unwrap_or(1);
        (ch.file_path.clone(), fs_service::chapter_rel_path(&book.slug, index, new_title))
    };
    let old_abs = s.root.join(&old_rel);
    let new_abs = s.root.join(&new_rel);
    if old_abs != new_abs && new_abs.exists() {
        return Err(AppError::Invalid("目标文件名已存在".into()));
    }
    if let Some(p) = old_abs.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::rename(&old_abs, &new_abs)?;
    lock(s).and_then(|conn| repo::chapters::rename(&*conn, id, new_title, &new_rel))
}

/// 删除章 = 软删：md 移入 {book}/.trash/，行标 deleted_at（M2-T6）
pub fn delete_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    trash::soft_delete_chapter_inner(s, id)
}

pub fn read_chapter_inner(s: &AppState, id: i64) -> AppResult<ChapterContent> {
    let meta = {
        let conn = lock(s)?;
        repo::chapters::get(&*conn, id)?
    };
    let content = fs_service::read_chapter(&s.root, &meta.file_path)?;
    Ok(ChapterContent { meta, content })
}

pub fn write_chapter_inner(s: &AppState, id: i64, content: &str) -> AppResult<ChapterMeta> {
    let rel = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?.file_path;
    fs_service::write_chapter(&s.root, &rel, content)?;
    let wc = count_words(content);
    lock(s).and_then(|conn| repo::chapters::touch_content(&*conn, id, wc))
}

/// 从磁盘 md 文件重建索引：书按 slug 复用 id，已存在的 file_path 跳过。返回扫描到的章节数。
pub fn rescan_library_inner(s: &AppState) -> AppResult<i64> {
    let scanned = fs_service::scan_library(&s.root)?;
    let mut total: i64 = 0;
    for b in scanned {
        let book = {
            let conn = lock(s)?;
            match repo::books::get_by_slug(&conn, &b.slug)? {
                Some(existing) => existing,
                None => repo::books::create(&*conn, &b.title, &b.slug)?,
            }
        };
        for rel in b.files {
            // 标题取文件名去序号与扩展名：`0001-yi.md` → `yi`；无连字符取全名
            let file_name = rel.rsplit('/').next().unwrap();
            let base = file_name.strip_suffix(".md").unwrap_or(file_name);
            let title = match base.split_once('-') {
                Some((_, t)) => t.to_string(),
                None => base.to_string(),
            };
            let existing = {
                let conn = lock(s)?;
                let all = repo::chapters::list_by_book(&*conn, book.id)?;
                all.into_iter().find(|c| c.file_path == rel)
            };
            if existing.is_none() {
                let wc = count_words(&fs_service::read_chapter(&s.root, &rel)?);
                let conn = lock(s)?;
                let created = repo::chapters::create(&*conn, book.id, &rel, &title)?;
                repo::chapters::touch_content(&*conn, created.id, wc)?;
            }
            total += 1;
        }
    }
    Ok(total)
}

// ---- Tauri 薄包装 ----
#[tauri::command]
pub fn list_books(s: State<AppState>) -> AppResult<Vec<Book>> {
    list_books_inner(&s)
}

#[tauri::command]
pub fn create_book(s: State<AppState>, title: String) -> AppResult<Book> {
    create_book_inner(&s, &title)
}

#[tauri::command]
pub fn delete_book(s: State<AppState>, id: i64) -> AppResult<()> {
    delete_book_inner(&s, id)
}

#[tauri::command]
pub fn list_chapters(s: State<AppState>, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    list_chapters_inner(&s, book_id)
}

#[tauri::command]
pub fn create_chapter(s: State<AppState>, book_id: i64, title: String) -> AppResult<ChapterMeta> {
    create_chapter_inner(&s, book_id, &title)
}

#[tauri::command]
pub fn rename_chapter(s: State<AppState>, id: i64, new_title: String) -> AppResult<ChapterMeta> {
    rename_chapter_inner(&s, id, &new_title)
}

#[tauri::command]
pub fn delete_chapter(s: State<AppState>, id: i64) -> AppResult<()> {
    delete_chapter_inner(&s, id)
}

#[tauri::command]
pub fn read_chapter(s: State<AppState>, id: i64) -> AppResult<ChapterContent> {
    read_chapter_inner(&s, id)
}

#[tauri::command]
pub fn write_chapter(s: State<AppState>, id: i64, content: String) -> AppResult<ChapterMeta> {
    write_chapter_inner(&s, id, &content)
}

#[tauri::command]
pub fn rescan_library(s: State<AppState>) -> AppResult<i64> {
    rescan_library_inner(&s)
}

// ---- M2-T6 回收站（inner 实现在 trash.rs） ----

#[tauri::command]
pub fn list_trash(s: State<AppState>, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    trash::list_trash_inner(&s, book_id)
}

#[tauri::command]
pub fn restore_chapter(s: State<AppState>, id: i64) -> AppResult<()> {
    trash::restore_chapter_inner(&s, id)
}

#[tauri::command]
pub fn purge_chapter(s: State<AppState>, id: i64) -> AppResult<()> {
    trash::purge_chapter_inner(&s, id)
}

#[tauri::command]
pub fn empty_trash(s: State<AppState>, book_id: i64) -> AppResult<()> {
    trash::empty_trash_inner(&s, book_id)
}

#[tauri::command]
pub fn list_trash_books(s: State<AppState>) -> AppResult<Vec<Book>> {
    trash::list_trash_books_inner(&s)
}

#[tauri::command]
pub fn restore_book(s: State<AppState>, id: i64) -> AppResult<()> {
    trash::restore_book_inner(&s, id)
}

#[tauri::command]
pub fn purge_book(s: State<AppState>, id: i64) -> AppResult<()> {
    trash::purge_book_inner(&s, id)
}
