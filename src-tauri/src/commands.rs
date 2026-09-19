use tauri::State;

use crate::error::{AppError, AppResult};
use crate::bump;
use crate::fs_service;
use crate::history;
use crate::models::{Book, BumpWord, ChapterContent, ChapterMeta, DailyStat, Foreshadow, ForeshadowInput, Idea};
use crate::porting;
use crate::repo;
use crate::search;
use crate::sensitive;
use crate::state::AppState;
use crate::stats;
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
    let ctx = history_ctx(s, id)?;
    fs_service::write_chapter(&s.root, &ctx.rel, content)?;
    let wc = count_words(content);
    // M2-T7 快照钩子：落盘成功后记录本版本（空内容/无实质改动/同一时段内则内部跳过）。
    // snapshot 吞掉 IO 错误并返回 bool——历史写入失败绝不阻断正文保存。
    history::snapshot(
        &s.root.join(&ctx.book_slug),
        &ctx.slug,
        &ctx.title,
        content,
        &ctx.ts,
        history::SnapshotMode::Auto,
    );
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

// ---- M2-T7 章节快照版本历史（实现在 history.rs） ----

/// 章节 → 快照落点上下文。章节 slug 取 md 文件名主干（如 `0001-yi`）：
/// 重命名章节会另起一份历史，换取 DB 重建后按文件名仍能对上（md 是唯一真源）。
struct HistoryCtx {
    /// md 相对路径（正文写入用）
    rel: String,
    /// 书目录 slug（软删书时指向 .trash_books/ 内位置）
    book_slug: String,
    slug: String,
    title: String,
    /// 本地时间戳，与章节行读取共用一次锁
    ts: String,
}

fn history_ctx(s: &AppState, id: i64) -> AppResult<HistoryCtx> {
    let conn = lock(s)?;
    let ch = repo::chapters::get(&*conn, id)?;
    let book = repo::books::get(&*conn, ch.book_id)?;
    let file_name = ch.file_path.rsplit('/').next().unwrap_or(&ch.file_path);
    let slug = file_name.strip_suffix(".md").unwrap_or(file_name).to_string();
    Ok(HistoryCtx {
        rel: ch.file_path.clone(),
        book_slug: book.slug,
        slug,
        title: ch.title,
        ts: history::local_now(&*conn)?,
    })
}

pub fn list_history_inner(s: &AppState, chapter_id: i64) -> AppResult<Vec<history::SnapshotInfo>> {
    let ctx = history_ctx(s, chapter_id)?;
    Ok(history::list_snapshots(&s.root.join(&ctx.book_slug), &ctx.slug))
}

pub fn read_history_inner(s: &AppState, chapter_id: i64, file: &str) -> AppResult<String> {
    let ctx = history_ctx(s, chapter_id)?;
    history::read_snapshot(&s.root.join(&ctx.book_slug), &ctx.slug, file)
}

/// 把给定内容存为该章的一次快照。前端在恢复旧版前用它做保险——传入的是编辑器**实时**内容，
/// 故自动保存防抖窗口（800ms）内尚未落盘的输入也不会丢。
/// 用 Force 模式：无视时间分桶，必须落一版（否则这次恢复就不可逆了）；内容空或与最近快照相同则为 no-op。
pub fn snapshot_now_inner(s: &AppState, chapter_id: i64, content: &str) -> AppResult<bool> {
    let ctx = history_ctx(s, chapter_id)?;
    Ok(history::snapshot(
        &s.root.join(&ctx.book_slug),
        &ctx.slug,
        &ctx.title,
        content,
        &ctx.ts,
        history::SnapshotMode::Force,
    ))
}

#[tauri::command]
pub fn list_history(s: State<AppState>, chapter_id: i64) -> AppResult<Vec<history::SnapshotInfo>> {
    list_history_inner(&s, chapter_id)
}

#[tauri::command]
pub fn read_history(s: State<AppState>, chapter_id: i64, file: String) -> AppResult<String> {
    read_history_inner(&s, chapter_id, &file)
}

#[tauri::command]
pub fn snapshot_now(s: State<AppState>, chapter_id: i64, content: String) -> AppResult<bool> {
    snapshot_now_inner(&s, chapter_id, &content)
}

// ---- M2-T8 导入导出（实现在 porting/） ----

/// 读文件并分章预览（.docx 走 docx 解析，其余按编码检测后分章）；只读不落库
#[tauri::command]
pub fn preview_import(path: String) -> AppResult<Vec<porting::import::ParsedChapter>> {
    porting::import::preview_import_inner(std::path::Path::new(&path))
}

/// 把预览中勾选的章批量落库（标题 + 正文建章、写 md、统计字数）
#[tauri::command]
pub fn import_chapters(
    s: State<AppState>,
    book_id: i64,
    chapters: Vec<porting::import::ParsedChapter>,
) -> AppResult<porting::import::ImportReport> {
    porting::import::import_chapters_inner(&s, book_id, &chapters)
}

/// 导出纯文本；`chapter_ids` 为空表示全书，`dest` 为目标文件路径
#[tauri::command]
pub fn export_txt(
    s: State<AppState>,
    book_id: i64,
    chapter_ids: Vec<i64>,
    indent: bool,
    dest: String,
) -> AppResult<()> {
    porting::export::export_txt_inner(
        &s,
        book_id,
        &porting::export::ExportRange { chapter_ids },
        indent,
        std::path::Path::new(&dest),
    )
}

#[tauri::command]
pub fn export_docx(
    s: State<AppState>,
    book_id: i64,
    chapter_ids: Vec<i64>,
    dest: String,
) -> AppResult<()> {
    porting::export::export_docx_inner(
        &s,
        book_id,
        &porting::export::ExportRange { chapter_ids },
        std::path::Path::new(&dest),
    )
}

// ---- M2-T9 全书搜索（实现在 search.rs） ----

#[tauri::command]
pub fn search_book(
    s: State<AppState>,
    book_id: i64,
    query: String,
    whole_word: bool,
) -> AppResult<search::SearchResult> {
    search::search_book_inner(&s, book_id, &query, whole_word)
}

// ---- M2-T10 碰碰车（实现在 bump.rs / repo/） ----

#[tauri::command]
pub fn bump_list_words(s: State<AppState>) -> AppResult<Vec<BumpWord>> {
    bump::list_words_inner(&s)
}

#[tauri::command]
pub fn bump_add_word(s: State<AppState>, word: String) -> AppResult<BumpWord> {
    bump::add_word_inner(&s, &word)
}

#[tauri::command]
pub fn bump_delete_word(s: State<AppState>, id: i64) -> AppResult<()> {
    bump::delete_word_inner(&s, id)
}

#[tauri::command]
pub fn bump_clear_words(s: State<AppState>) -> AppResult<()> {
    bump::clear_words_inner(&s)
}

/// 碰撞：随机抽 2-4 个词（种子取当前时间，见 bump.rs）
#[tauri::command]
pub fn bump_draw(s: State<AppState>, count: i64) -> AppResult<Vec<String>> {
    bump::draw_inner(&s, count)
}

#[tauri::command]
pub fn ideas_list(s: State<AppState>) -> AppResult<Vec<Idea>> {
    bump::list_ideas_inner(&s)
}

#[tauri::command]
pub fn ideas_create(
    s: State<AppState>,
    content: String,
    words_json: String,
    tags_json: String,
) -> AppResult<Idea> {
    bump::create_idea_inner(&s, &content, &words_json, &tags_json)
}

#[tauri::command]
pub fn ideas_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    bump::delete_idea_inner(&s, id)
}

// ---- M2-T11 写作统计与敏感词（实现在 stats.rs / sensitive.rs） ----

/// 累加当日写作字数；`count_minute` 为真时活跃分钟 +1（同一分钟只传一次）
#[tauri::command]
pub fn stats_add(
    s: State<AppState>,
    book_id: i64,
    delta_words: i64,
    count_minute: bool,
) -> AppResult<()> {
    stats::add_inner(&s, book_id, delta_words, count_minute)
}

#[tauri::command]
pub fn stats_today(s: State<AppState>, book_id: i64) -> AppResult<stats::WritingStat> {
    stats::today_inner(&s, book_id)
}

#[tauri::command]
pub fn sensitive_get_words(s: State<AppState>) -> AppResult<Vec<String>> {
    sensitive::get_words_inner(&s)
}

/// 保存词库（一行一词；返回清洗去重后的结果）
#[tauri::command]
pub fn sensitive_set_words(s: State<AppState>, words: Vec<String>) -> AppResult<Vec<String>> {
    sensitive::set_words_inner(&s, &words)
}

/// 用已存词库扫描正文（只报告，不改正文）
#[tauri::command]
pub fn sensitive_scan(s: State<AppState>, content: String) -> AppResult<Vec<sensitive::Hit>> {
    sensitive::scan_inner(&s, &content)
}

/// 从 txt 导入词库（只解析返回，保存由用户确认）
#[tauri::command]
pub fn sensitive_import_words(path: String) -> AppResult<Vec<String>> {
    sensitive::import_words_inner(std::path::Path::new(&path))
}

// ---- M3-T1 数据层：通用设置 / 统计查询 / 目标字数 / 伏笔 ----

pub fn setting_get_inner(s: &AppState, key: &str) -> AppResult<Option<String>> {
    repo::settings::get(&*lock(s)?, key)
}

pub fn setting_set_inner(s: &AppState, key: &str, value: &str) -> AppResult<()> {
    repo::settings::set(&*lock(s)?, key, value)
}

pub fn books_set_target_inner(s: &AppState, book_id: i64, target_words: Option<i64>) -> AppResult<Book> {
    repo::books::set_target(&*lock(s)?, book_id, target_words)
}

pub fn foreshadows_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Foreshadow>> {
    repo::foreshadows::list_by_book(&*lock(s)?, book_id)
}

pub fn foreshadow_upsert_inner(s: &AppState, input: &ForeshadowInput) -> AppResult<Foreshadow> {
    repo::foreshadows::upsert(&*lock(s)?, input)
}

pub fn foreshadow_set_status_inner(
    s: &AppState,
    id: i64,
    status: &str,
    resolved_chapter_id: Option<i64>,
) -> AppResult<Foreshadow> {
    repo::foreshadows::set_status(&*lock(s)?, id, status, resolved_chapter_id)
}

pub fn foreshadow_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::foreshadows::delete(&*lock(s)?, id)
}

#[tauri::command]
pub fn setting_get(s: State<AppState>, key: String) -> AppResult<Option<String>> {
    setting_get_inner(&s, &key)
}

#[tauri::command]
pub fn setting_set(s: State<AppState>, key: String, value: String) -> AppResult<()> {
    setting_set_inner(&s, &key, &value)
}

#[tauri::command]
pub fn stats_range(s: State<AppState>, days: u32, book_id: Option<i64>) -> AppResult<Vec<DailyStat>> {
    stats::range_inner(&s, days, book_id)
}

#[tauri::command]
pub fn books_set_target(s: State<AppState>, book_id: i64, target_words: Option<i64>) -> AppResult<Book> {
    books_set_target_inner(&s, book_id, target_words)
}

#[tauri::command]
pub fn foreshadows_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Foreshadow>> {
    foreshadows_list_inner(&s, book_id)
}

#[tauri::command]
pub fn foreshadow_upsert(s: State<AppState>, input: ForeshadowInput) -> AppResult<Foreshadow> {
    foreshadow_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn foreshadow_set_status(
    s: State<AppState>,
    id: i64,
    status: String,
    resolved_chapter_id: Option<i64>,
) -> AppResult<Foreshadow> {
    foreshadow_set_status_inner(&s, id, &status, resolved_chapter_id)
}

#[tauri::command]
pub fn foreshadow_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    foreshadow_delete_inner(&s, id)
}
