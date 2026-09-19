use tauri::State;

use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::models::{Book, ChapterContent, ChapterMeta};
use crate::repo;
use crate::state::AppState;
use crate::util::count_words;

fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
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

pub fn delete_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    let book = lock(s).and_then(|conn| repo::books::get(&*conn, id))?;
    fs_service::delete_rel(&s.root, &book.slug)?;
    lock(s).and_then(|conn| repo::books::delete(&*conn, id))
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

pub fn delete_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    let rel = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?.file_path;
    fs_service::delete_rel(&s.root, &rel)?;
    lock(s).and_then(|conn| repo::chapters::delete(&*conn, id))
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
