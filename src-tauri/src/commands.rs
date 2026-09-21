use tauri::State;

use crate::error::{AppError, AppResult};
use crate::bump;
use crate::fs_service;
use crate::history;
use crate::links;
use crate::models::{Backlink, BgImage, Book, BumpWord, ChapterContent, ChapterMeta, ChapterMetaUpdate, ChapterTemplate, ChapterTemplateInput, Character, CharacterInput, CharacterMention, CharacterRelation, CharacterRelationInput, DailyStat, Foreshadow, ForeshadowInput, Idea, Keyword, Label, LabelInput, Map, Material, MaterialInput, Outline, OutlineInput, Place, PlaceInput, PlotBlock, PlotBlockInput, Status, StatusInput, WikiLink};
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
    let book = {
        let conn = lock(s)?;
        let book = repo::books::create(&*conn, title, &slug)?;
        repo::meta::seed_defaults(&*conn, book.id)?;
        book
    };
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
    let (slug, index, tpl_content) = {
        let conn = lock(s)?;
        let book = repo::books::get(&*conn, book_id)?;
        let index = repo::chapters::next_index(&*conn, book_id)?;
        // 书的默认模板作为新章初始正文（Scrivener DefaultChildTemplateUUID 的对应物）
        let tpl = repo::chapter_templates::get_default(&*conn, book_id)?
            .map(|t| t.content)
            .unwrap_or_default();
        (book.slug, index, tpl)
    };
    let rel = fs_service::chapter_rel_path(&slug, index, title);
    fs_service::write_chapter(&s.root, &rel, &tpl_content)?;
    lock(s).and_then(|conn| repo::chapters::create(&*conn, book_id, &rel, title))
}

/// 批量重排章节（侧栏/卡片墙拖拽后调用）；清单必须同书，否则整批拒绝。
pub fn reorder_chapters_inner(s: &AppState, ids: &[i64]) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let conn = lock(s)?;
    let placeholders = vec!["?"; ids.len()].join(",");
    let distinct: i64 = conn.query_row(
        &format!("SELECT COUNT(DISTINCT book_id) FROM chapters WHERE id IN ({placeholders})"),
        rusqlite::params_from_iter(ids.iter()),
        |r| r.get(0),
    )?;
    if distinct > 1 {
        return Err(AppError::Invalid("章节清单跨书，拒绝重排".into()));
    }
    repo::chapters::reorder(&*conn, ids)
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

// ---- M7 批次1：章节元数据（标签/状态/关键词/梗概/目标） ----

pub fn labels_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Label>> {
    repo::meta::labels_list(&*lock(s)?, book_id)
}

pub fn label_upsert_inner(s: &AppState, input: &LabelInput) -> AppResult<Label> {
    repo::meta::label_upsert(&*lock(s)?, input)
}

pub fn label_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::meta::label_delete(&*lock(s)?, id)
}

pub fn statuses_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Status>> {
    repo::meta::statuses_list(&*lock(s)?, book_id)
}

pub fn status_upsert_inner(s: &AppState, input: &StatusInput) -> AppResult<Status> {
    repo::meta::status_upsert(&*lock(s)?, input)
}

pub fn status_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::meta::status_delete(&*lock(s)?, id)
}

pub fn keywords_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Keyword>> {
    repo::meta::keywords_list(&*lock(s)?, book_id)
}

pub fn keyword_create_inner(s: &AppState, book_id: i64, title: &str, color: Option<&str>) -> AppResult<Keyword> {
    repo::meta::keyword_create(&*lock(s)?, book_id, title, color)
}

pub fn keyword_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::meta::keyword_delete(&*lock(s)?, id)
}

pub fn chapter_update_meta_inner(s: &AppState, id: i64, update: &ChapterMetaUpdate) -> AppResult<ChapterMeta> {
    repo::chapters::update_meta(&*lock(s)?, id, update)
}

pub fn keywords_for_chapter_inner(s: &AppState, chapter_id: i64) -> AppResult<Vec<Keyword>> {
    repo::meta::keywords_for_chapter(&*lock(s)?, chapter_id)
}

pub fn chapter_set_keywords_inner(s: &AppState, chapter_id: i64, keyword_ids: &[i64]) -> AppResult<Vec<Keyword>> {
    repo::meta::chapter_set_keywords(&*lock(s)?, chapter_id, keyword_ids)
}

#[tauri::command]
pub fn labels_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Label>> {
    labels_list_inner(&s, book_id)
}

#[tauri::command]
pub fn label_upsert(s: State<AppState>, input: LabelInput) -> AppResult<Label> {
    label_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn label_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    label_delete_inner(&s, id)
}

#[tauri::command]
pub fn statuses_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Status>> {
    statuses_list_inner(&s, book_id)
}

#[tauri::command]
pub fn status_upsert(s: State<AppState>, input: StatusInput) -> AppResult<Status> {
    status_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn status_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    status_delete_inner(&s, id)
}

#[tauri::command]
pub fn keywords_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Keyword>> {
    keywords_list_inner(&s, book_id)
}

#[tauri::command]
pub fn keyword_create(s: State<AppState>, book_id: i64, title: String, color: Option<String>) -> AppResult<Keyword> {
    keyword_create_inner(&s, book_id, &title, color.as_deref())
}

#[tauri::command]
pub fn keyword_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    keyword_delete_inner(&s, id)
}

#[tauri::command]
pub fn chapter_update_meta(s: State<AppState>, id: i64, update: ChapterMetaUpdate) -> AppResult<ChapterMeta> {
    chapter_update_meta_inner(&s, id, &update)
}

#[tauri::command]
pub fn keywords_for_chapter(s: State<AppState>, chapter_id: i64) -> AppResult<Vec<Keyword>> {
    keywords_for_chapter_inner(&s, chapter_id)
}

#[tauri::command]
pub fn chapter_set_keywords(s: State<AppState>, chapter_id: i64, keyword_ids: Vec<i64>) -> AppResult<Vec<Keyword>> {
    chapter_set_keywords_inner(&s, chapter_id, &keyword_ids)
}

// ---- M7 批次2：章节重排与章节模板 ----

pub fn templates_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<ChapterTemplate>> {
    repo::chapter_templates::list_by_book(&*lock(s)?, book_id)
}

pub fn template_upsert_inner(s: &AppState, input: &ChapterTemplateInput) -> AppResult<ChapterTemplate> {
    repo::chapter_templates::upsert(&*lock(s)?, input)
}

pub fn template_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::chapter_templates::delete(&*lock(s)?, id)
}

pub fn template_set_default_inner(s: &AppState, id: i64, is_default: bool) -> AppResult<ChapterTemplate> {
    repo::chapter_templates::set_default(&*lock(s)?, id, is_default)
}

#[tauri::command]
pub fn reorder_chapters(s: State<AppState>, ids: Vec<i64>) -> AppResult<()> {
    reorder_chapters_inner(&s, &ids)
}

// ---- M7 批次3：wiki 双链与人物提及（链接以 [[章题]] 纯文本活在正文，按需扫描派生） ----

pub fn links_scan_inner(s: &AppState, book_id: i64) -> AppResult<Vec<WikiLink>> {
    links::scan_book(s, book_id)
}

pub fn chapter_backlinks_inner(s: &AppState, chapter_id: i64) -> AppResult<Vec<Backlink>> {
    links::backlinks_for(s, chapter_id)
}

pub fn character_mentions_inner(s: &AppState, book_id: i64) -> AppResult<Vec<CharacterMention>> {
    links::mentions(s, book_id)
}

#[tauri::command]
pub fn links_scan(s: State<AppState>, book_id: i64) -> AppResult<Vec<WikiLink>> {
    links_scan_inner(&s, book_id)
}

#[tauri::command]
pub fn chapter_backlinks(s: State<AppState>, chapter_id: i64) -> AppResult<Vec<Backlink>> {
    chapter_backlinks_inner(&s, chapter_id)
}

#[tauri::command]
pub fn character_mentions(s: State<AppState>, book_id: i64) -> AppResult<Vec<CharacterMention>> {
    character_mentions_inner(&s, book_id)
}

#[tauri::command]
pub fn templates_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<ChapterTemplate>> {
    templates_list_inner(&s, book_id)
}

#[tauri::command]
pub fn template_upsert(s: State<AppState>, input: ChapterTemplateInput) -> AppResult<ChapterTemplate> {
    template_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn template_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    template_delete_inner(&s, id)
}

#[tauri::command]
pub fn template_set_default(s: State<AppState>, id: i64, is_default: bool) -> AppResult<ChapterTemplate> {
    template_set_default_inner(&s, id, is_default)
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

/// 读文件并分章预览（.docx 走 docx 解析，其余按编码检测后分章）；只读不落库。
/// 自定义分章规则（settings customChapterRules）在此编译应用（M4-T2）
#[tauri::command]
pub fn preview_import(s: State<AppState>, path: String) -> AppResult<Vec<porting::import::ParsedChapter>> {
    let rules = porting::import::load_custom_rules(&s);
    porting::import::preview_import_inner(std::path::Path::new(&path), &rules)
}

/// 文件夹成书导入预览（M4-T3）：目录内 *.md/*.txt 按文件名自然序一文件一章；只读不落库
#[tauri::command]
pub fn preview_import_dir(path: String) -> AppResult<Vec<porting::import::ParsedChapter>> {
    porting::import::preview_import_dir_inner(std::path::Path::new(&path))
}

/// 导入查重（M4-T4）：预览章内容与目标书已落库章的 content_hash 比对，逐条返回疑似重复
pub fn check_duplicates_inner(s: &AppState, book_id: i64, contents: &[String]) -> AppResult<Vec<bool>> {
    let known: std::collections::HashSet<String> =
        repo::chapters::hashes_for_book(&*lock(s)?, book_id)?.into_iter().collect();
    Ok(contents.iter().map(|c| known.contains(&porting::import::content_md5(c))).collect())
}

#[tauri::command]
pub fn check_duplicates(s: State<AppState>, bookId: i64, contents: Vec<String>) -> AppResult<Vec<bool>> {
    check_duplicates_inner(&s, bookId, &contents)
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

// ---- M4 人物卡 ----

pub fn characters_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Character>> {
    repo::characters::list_by_book(&*lock(s)?, book_id)
}

pub fn character_upsert_inner(s: &AppState, input: &CharacterInput) -> AppResult<Character> {
    repo::characters::upsert(&*lock(s)?, input)
}

pub fn character_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::characters::delete(&*lock(s)?, id)
}

// ---- M4 大纲体系 ----

pub fn outlines_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Outline>> {
    repo::outlines::list_by_book(&*lock(s)?, book_id)
}

pub fn outline_upsert_inner(s: &AppState, input: &OutlineInput) -> AppResult<Outline> {
    repo::outlines::upsert(&*lock(s)?, input)
}

pub fn outline_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::outlines::delete(&*lock(s)?, id)
}

// ---- M4 素材库 / 情节块 ----

pub fn materials_list_inner(s: &AppState, query: Option<String>) -> AppResult<Vec<Material>> {
    repo::materials::search(&*lock(s)?, query.as_deref().unwrap_or(""))
}

pub fn material_upsert_inner(s: &AppState, input: &MaterialInput) -> AppResult<Material> {
    repo::materials::upsert(&*lock(s)?, input)
}

pub fn material_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::materials::delete(&*lock(s)?, id)
}

pub fn plot_blocks_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<PlotBlock>> {
    repo::plot_blocks::list_by_book(&*lock(s)?, book_id)
}

pub fn plot_block_upsert_inner(s: &AppState, input: &PlotBlockInput) -> AppResult<PlotBlock> {
    repo::plot_blocks::upsert(&*lock(s)?, input)
}

pub fn plot_block_reorder_inner(s: &AppState, ids: &[i64]) -> AppResult<()> {
    repo::plot_blocks::reorder(&*lock(s)?, ids)
}

pub fn plot_block_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::plot_blocks::delete(&*lock(s)?, id)
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

#[tauri::command]
pub fn characters_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Character>> {
    characters_list_inner(&s, book_id)
}

#[tauri::command]
pub fn character_upsert(s: State<AppState>, input: CharacterInput) -> AppResult<Character> {
    character_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn character_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    character_delete_inner(&s, id)
}

// ---------- M5 图谱：角色关系 ----------

pub fn relations_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<CharacterRelation>> {
    repo::relations::list_by_book(&*lock(s)?, book_id)
}

pub fn relation_upsert_inner(
    s: &AppState,
    input: &CharacterRelationInput,
) -> AppResult<CharacterRelation> {
    repo::relations::upsert(&*lock(s)?, input)
}

pub fn relation_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::relations::delete(&*lock(s)?, id)
}

#[tauri::command]
pub fn relations_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<CharacterRelation>> {
    relations_list_inner(&s, book_id)
}

#[tauri::command]
pub fn relation_upsert(
    s: State<AppState>,
    input: CharacterRelationInput,
) -> AppResult<CharacterRelation> {
    relation_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn relation_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    relation_delete_inner(&s, id)
}

// ---------- M5 图谱：世界地图 ----------

const MAP_ALLOWED_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const MAP_MAX_BYTES: u64 = 10 * 1024 * 1024;

fn maps_dir(s: &AppState) -> std::path::PathBuf {
    // root = {appData}/library，其上级即 appData（与 background/ 同级）
    s.config_dir().join("maps")
}

pub fn maps_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<Map>> {
    repo::maps::list_maps_by_book(&*lock(s)?, book_id)
}

/// 校验源图（ext 白名单 + 10MB），复制进 maps/ 后建行；建行失败回滚删文件。
pub fn map_import_inner(s: &AppState, book_id: i64, name: &str, src_path: &str) -> AppResult<Map> {
    let src = std::path::Path::new(src_path);
    if !src.is_file() {
        return Err(AppError::NotFound("地图图片文件不存在".into()));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !MAP_ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Invalid("仅支持 png / jpg / jpeg / webp / gif 图片".into()));
    }
    let meta = std::fs::metadata(src)?;
    if meta.len() > MAP_MAX_BYTES {
        return Err(AppError::Invalid("地图图片不能超过 10MB".into()));
    }
    // 名称入参为空时回退文件名（去非法字符）
    let display = {
        let n = name.trim();
        if n.is_empty() {
            bg_sanitize_name(src.file_stem().and_then(|n| n.to_str()).unwrap_or("地图"))
        } else {
            bg_sanitize_name(n)
        }
    };
    let dir = maps_dir(s);
    std::fs::create_dir_all(&dir)?;
    // 文件名复用 bg 的纳秒序 hex id，天然唯一且不依赖 DB 自增号
    let dest = dir.join(format!("{}-{display}.{ext}", next_bg_id()));
    std::fs::copy(src, &dest)?;
    let inserted = lock(s).and_then(|conn| {
        repo::maps::insert_map(&*conn, book_id, &display, &dest.to_string_lossy())
    });
    if inserted.is_err() {
        let _ = std::fs::remove_file(&dest);
    }
    inserted
}

pub fn map_rename_inner(s: &AppState, id: i64, name: &str) -> AppResult<Map> {
    repo::maps::rename_map(&*lock(s)?, id, name)
}

pub fn map_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    let path = lock(s).and_then(|conn| repo::maps::delete_map(&*conn, id))?;
    // 文件可能已缺失（历史残留），缺失不视为失败
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.into()),
    }
}

pub fn places_list_inner(s: &AppState, map_id: i64) -> AppResult<Vec<Place>> {
    repo::maps::list_places_by_map(&*lock(s)?, map_id)
}

pub fn place_upsert_inner(s: &AppState, input: &PlaceInput) -> AppResult<Place> {
    repo::maps::upsert_place(&*lock(s)?, input)
}

pub fn place_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::maps::delete_place(&*lock(s)?, id)
}

#[tauri::command]
pub fn maps_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Map>> {
    maps_list_inner(&s, book_id)
}

#[tauri::command]
pub fn map_import(
    s: State<AppState>,
    book_id: i64,
    name: String,
    src_path: String,
) -> AppResult<Map> {
    map_import_inner(&s, book_id, &name, &src_path)
}

#[tauri::command]
pub fn map_rename(s: State<AppState>, id: i64, name: String) -> AppResult<Map> {
    map_rename_inner(&s, id, &name)
}

#[tauri::command]
pub fn map_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    map_delete_inner(&s, id)
}

#[tauri::command]
pub fn places_list(s: State<AppState>, map_id: i64) -> AppResult<Vec<Place>> {
    places_list_inner(&s, map_id)
}

#[tauri::command]
pub fn place_upsert(s: State<AppState>, input: PlaceInput) -> AppResult<Place> {
    place_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn place_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    place_delete_inner(&s, id)
}

#[tauri::command]
pub fn outlines_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<Outline>> {
    outlines_list_inner(&s, book_id)
}

#[tauri::command]
pub fn outline_upsert(s: State<AppState>, input: OutlineInput) -> AppResult<Outline> {
    outline_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn outline_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    outline_delete_inner(&s, id)
}

#[tauri::command]
pub fn materials_list(s: State<AppState>, query: Option<String>) -> AppResult<Vec<Material>> {
    materials_list_inner(&s, query)
}

#[tauri::command]
pub fn material_upsert(s: State<AppState>, input: MaterialInput) -> AppResult<Material> {
    material_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn material_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    material_delete_inner(&s, id)
}

#[tauri::command]
pub fn plot_blocks_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<PlotBlock>> {
    plot_blocks_list_inner(&s, book_id)
}

#[tauri::command]
pub fn plot_block_upsert(s: State<AppState>, input: PlotBlockInput) -> AppResult<PlotBlock> {
    plot_block_upsert_inner(&s, &input)
}

#[tauri::command]
pub fn plot_block_reorder(s: State<AppState>, ids: Vec<i64>) -> AppResult<()> {
    plot_block_reorder_inner(&s, &ids)
}

#[tauri::command]
pub fn plot_block_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    plot_block_delete_inner(&s, id)
}

// ---- M3-T6 阅读背景图（纯文件操作，不碰 db 锁） ----

/// 允许的图片扩展（小写比较；gif/webp/png/jpg/jpeg）
const BG_ALLOWED_EXTS: &[&str] = &["png", "jpg", "jpeg", "webp", "gif"];
const BG_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// id 单调递增保险：同一纳秒内连续导入也各得其一
static BG_ID_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

fn bg_dir(s: &AppState) -> std::path::PathBuf {
    // root = {appData}/library，其上级即 appData
    s.config_dir().join("background")
}

fn next_bg_id() -> String {
    use std::sync::atomic::Ordering;
    use std::time::{SystemTime, UNIX_EPOCH};
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let prev = BG_ID_SEQ.load(Ordering::Relaxed);
    let id = if now > prev { now } else { prev + 1 };
    BG_ID_SEQ.store(id, Ordering::Relaxed);
    format!("{id:x}")
}

/// name 净化：Windows 非法字符与控制符换 _，限长 60，首尾空白/点去掉，空回「背景」
fn bg_sanitize_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.');
    let taken: String = trimmed.chars().take(60).collect();
    let taken = taken.trim().trim_matches('.');
    if taken.is_empty() {
        "背景".to_string()
    } else {
        taken.to_string()
    }
}

pub fn reading_bg_import_inner(s: &AppState, src_path: &str) -> AppResult<BgImage> {
    let src = std::path::Path::new(src_path);
    if !src.is_file() {
        return Err(AppError::NotFound("背景图文件不存在".into()));
    }
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !BG_ALLOWED_EXTS.contains(&ext.as_str()) {
        return Err(AppError::Invalid("仅支持 png / jpg / jpeg / webp / gif 图片".into()));
    }
    let meta = std::fs::metadata(src)?;
    if meta.len() > BG_MAX_BYTES {
        return Err(AppError::Invalid("背景图不能超过 10MB".into()));
    }
    let name = bg_sanitize_name(src.file_stem().and_then(|n| n.to_str()).unwrap_or("背景"));
    let id = next_bg_id();
    let dir = bg_dir(s);
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("{id}-{name}.{ext}"));
    std::fs::copy(src, &dest)?;
    Ok(BgImage {
        id,
        path: dest.to_string_lossy().into_owned(),
        name,
    })
}

pub fn reading_bg_list_inner(s: &AppState) -> AppResult<Vec<BgImage>> {
    let dir = bg_dir(s);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }
    let mut out: Vec<(String, BgImage)> = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !BG_ALLOWED_EXTS.contains(&ext.as_str()) {
            continue;
        }
        let file_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        let stem = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or(file_name.trim_end_matches(&format!(".{ext}")))
            .to_string();
        // 文件名 = {id}-{name}：首段「-」前为 id，其后还原 name；外来文件无 id 段则整体作 id
        let (id, name) = match stem.split_once('-') {
            Some((id, name)) => (id.to_string(), name.to_string()),
            None => (stem.clone(), stem),
        };
        if id.is_empty() {
            continue;
        }
        out.push((
            file_name,
            BgImage {
                id,
                path: path.to_string_lossy().into_owned(),
                name,
            },
        ));
    }
    // 文件名以 id 开头且等宽 hex → 字典序即导入先后
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out.into_iter().map(|(_, img)| img).collect())
}

pub fn reading_bg_delete_inner(s: &AppState, id: &str) -> AppResult<()> {
    let dir = bg_dir(s);
    if dir.is_dir() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let stem = match path.file_stem().and_then(|n| n.to_str()) {
                Some(n) => n,
                None => continue,
            };
            // 只按「{id}-」前缀（或恰好整段）匹配，id 串本身不会注入路径分隔
            if stem == id || stem.starts_with(&format!("{id}-")) {
                std::fs::remove_file(&path)?;
                return Ok(());
            }
        }
    }
    Err(AppError::NotFound("背景图不存在".into()))
}

#[tauri::command]
pub fn reading_bg_import(s: State<AppState>, src_path: String) -> AppResult<BgImage> {
    reading_bg_import_inner(&s, &src_path)
}

#[tauri::command]
pub fn reading_bg_list(s: State<AppState>) -> AppResult<Vec<BgImage>> {
    reading_bg_list_inner(&s)
}

#[tauri::command]
pub fn reading_bg_delete(s: State<AppState>, id: String) -> AppResult<()> {
    reading_bg_delete_inner(&s, &id)
}

#[cfg(test)]
mod bg_tests {
    use super::*;
    use crate::state::AppState;

    fn setup() -> (tempfile::TempDir, AppState) {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::test_state(tmp.path());
        (tmp, state)
    }

    fn write_file(dir: &std::path::Path, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let p = dir.join(name);
        std::fs::write(&p, bytes).unwrap();
        p
    }

    #[test]
    fn bg_import_list_delete_roundtrip() {
        let (tmp, s) = setup();
        // 目录缺失 → list 回空
        assert!(reading_bg_list_inner(&s).unwrap().is_empty());

        let src = write_file(tmp.path(), "山间晨雾.png", b"fake png bytes");
        let img = reading_bg_import_inner(&s, src.to_str().unwrap()).unwrap();
        assert_eq!(img.name, "山间晨雾", "name 取原文件名");
        assert!(!img.id.is_empty(), "id = 纳秒 hex");
        assert!(img.path.ends_with(".png"));
        assert!(img.path.contains("background"), "拷到 appData/background/: {}", img.path);
        assert_eq!(
            std::fs::read(&img.path).unwrap(),
            b"fake png bytes",
            "内容完整拷贝"
        );

        // list：一条；name 从文件名还原（去 id 前缀）
        let list = reading_bg_list_inner(&s).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, img.id);
        assert_eq!(list[0].name, "山间晨雾");
        assert_eq!(list[0].path, img.path);

        // delete 后 list 空、文件删除
        reading_bg_delete_inner(&s, &img.id).unwrap();
        assert!(reading_bg_list_inner(&s).unwrap().is_empty());
        assert!(!std::path::Path::new(&img.path).exists());
    }

    #[test]
    fn bg_import_rejects_bad_extension_and_oversize() {
        let (tmp, s) = setup();
        let bmp = write_file(tmp.path(), "x.bmp", b"not an allowed image");
        let err = reading_bg_import_inner(&s, bmp.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "实际: {err:?}");

        let missing = reading_bg_import_inner(&s, "no/such/file.png").unwrap_err();
        assert!(matches!(missing, AppError::NotFound(_)), "实际: {missing:?}");

        // 大写扩展放行（按小写比较）
        let upper = write_file(tmp.path(), "UPPER.PNG", b"ok");
        assert!(reading_bg_import_inner(&s, upper.to_str().unwrap()).is_ok());

        // 超过 10MB 拒绝
        let big = tmp.path().join("big.png");
        std::fs::write(&big, vec![0u8; 10 * 1024 * 1024 + 1]).unwrap();
        let err = reading_bg_import_inner(&s, big.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::Invalid(_)), "实际: {err:?}");
    }

    #[test]
    fn bg_reimport_stores_duplicate_and_list_sorted_by_import() {
        let (tmp, s) = setup();
        let src = write_file(tmp.path(), "同一张.png", b"same bytes");

        let a = reading_bg_import_inner(&s, src.to_str().unwrap()).unwrap();
        let b = reading_bg_import_inner(&s, src.to_str().unwrap()).unwrap();
        assert_ne!(a.id, b.id, "重复导入多存一份（id 不同）");
        assert_eq!(reading_bg_list_inner(&s).unwrap().len(), 2);

        // 排序：id hex 升序 = 导入先后
        let list = reading_bg_list_inner(&s).unwrap();
        assert!(list[0].id < list[1].id, "{:?} 应按导入序", list);

        // 只删一份：删 b 后 a 还在
        reading_bg_delete_inner(&s, &b.id).unwrap();
        let rest = reading_bg_list_inner(&s).unwrap();
        assert_eq!(rest.len(), 1);
        assert_eq!(rest[0].id, a.id);
    }

    #[test]
    fn bg_name_sanitized_and_missing_delete_not_found() {
        let (tmp, s) = setup();
        // 文件名带 Windows 非法字符（构造不出非法路径本身，用正斜杠语义近似：
        // 这里主要测 name 还原与 delete 未命中）
        let src = write_file(tmp.path(), "旅行 照片.jpg", b"jpg");
        let img = reading_bg_import_inner(&s, src.to_str().unwrap()).unwrap();
        assert_eq!(img.name, "旅行 照片");

        // 未命中 id
        let err = reading_bg_delete_inner(&s, "deadbeef").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");

        // 空 id 也未命中（不会误删目录内全部）
        let err = reading_bg_delete_inner(&s, "").unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");
        assert_eq!(reading_bg_list_inner(&s).unwrap().len(), 1, "文件仍在");
    }
}

#[cfg(test)]
mod import_dedup_tests {
    use super::*;
    use crate::porting::import::{content_md5, import_chapters_inner, ParsedChapter};

    fn setup() -> (tempfile::TempDir, AppState) {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::test_state(tmp.path());
        (tmp, state)
    }

    fn ch(title: &str, content: &str) -> ParsedChapter {
        ParsedChapter { title: title.into(), content: content.into(), volume: None }
    }

    #[test]
    fn duplicates_flagged_within_same_book_only() {
        let (_tmp, s) = setup();
        let bid = create_book_inner(&s, "测试书").unwrap().id;
        import_chapters_inner(&s, bid, &[ch("一", "同样的内容"), ch("二", "别的内容")]).unwrap();

        let flags = check_duplicates_inner(&s, bid, &["同样的内容".into(), "第三种".into()]).unwrap();
        assert_eq!(flags, vec![true, false], "同书已有 hash 命中即疑似重复");

        let bid2 = create_book_inner(&s, "另一本书").unwrap().id;
        let flags2 = check_duplicates_inner(&s, bid2, &["同样的内容".into()]).unwrap();
        assert_eq!(flags2, vec![false], "查重范围=目标书，跨书不误报");
    }

    #[test]
    fn imported_chapters_carry_hash() {
        let (_tmp, s) = setup();
        let bid = create_book_inner(&s, "哈希书").unwrap().id;
        import_chapters_inner(&s, bid, &[ch("一", "内容甲")]).unwrap();
        let hashes = repo::chapters::hashes_for_book(&*lock(&s).unwrap(), bid).unwrap();
        assert_eq!(hashes, vec![content_md5("内容甲")]);
    }
}
