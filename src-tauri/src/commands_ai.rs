//! M1 AI 命令层：Provider / 文风 / 会话 / 流式发送 / 取消 / 上下文预览。
//! 阶段 2A：多轮对话（会话历史按预算注入）、写正文/讨论两模式、光标感知、本轮槽位开关、
//! @ 引用、重新生成保留版本、编辑重发、会话管理、错误分类与半截保留。
//! 全部走 M0 模式：`*_inner(&AppState)` 可测，`#[tauri::command]` 薄包装。

use tauri::{Emitter, Manager, State};
use tokio::sync::watch;

use crate::context::assembler::{assemble, Assembled, AssembleInput, AssemblyLog, Mode};
use crate::context::inject as inject_ctx;
use crate::context::InjectionInput;
use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::llm::provider;
use crate::llm::stream::{chat_stream, classify_error, next_token_alternatives, StreamEvent, StreamReq};
use crate::models::{AiMemory, AiTurnOptions, ChatMessage, ChatSession, ContextConfig, MaterialInput, ProviderProfile, SessionHit, StyleCard, TransientTask, WritingRule, WritingRuleInput};
use crate::repo;
use crate::state::AppState;

fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    s.db.lock().map_err(|_| AppError::LockPoisoned)
}

/// 组装上下文所需的素材（send 与 preview 共用读取路径）。
pub(crate) struct ContextBundle {
    book_title: String,
    style_prompt: Option<String>,
    chapter_text: String,
    prev_tail: Option<String>,
    injections: Vec<InjectionInput>,
    cursor_aware: bool,
    history: Vec<(String, String)>,
    /// 阶段 2B：常驻记忆（本书 + 所在卷）与来由
    memory: String,
    memory_reason: String,
    /// 阶段 2B：写作规则槽位（已按作用域筛好）
    rules: Option<InjectionInput>,
    /// 阶段 2B：本章作者注
    author_note: String,
    prev_title: Option<String>,
    budget_tokens: i64,
    /// 阶段 2C：光标后文（已剔除正文指令）、词语偏置、正文里的 {作者批注}
    cursor_after: Option<String>,
    phrase_bias: String,
    notes: Vec<String>,
}

pub(crate) fn assemble_with(bundle: &ContextBundle, instruction: &str, opts: &AiTurnOptions) -> Assembled {
    assemble(&AssembleInput {
        book_title: &bundle.book_title,
        style_prompt: bundle.style_prompt.as_deref(),
        chapter_text: &bundle.chapter_text,
        prev_chapter_tail: bundle.prev_tail.as_deref(),
        instruction,
        injections: bundle.injections.clone(),
        mode: Mode::parse(opts.mode.as_deref()),
        cursor_aware: bundle.cursor_aware,
        cursor_after: bundle.cursor_after.as_deref(),
        selection: opts.selection.as_deref(),
        history: bundle.history.clone(),
        disabled: opts.disabled_slots.clone(),
        target_chars: opts.target_chars,
        memory: Some(bundle.memory.as_str()),
        memory_reason: Some(bundle.memory_reason.as_str()),
        rules: bundle.rules.clone(),
        author_note: Some(bundle.author_note.as_str()),
        prev_title: bundle.prev_title.as_deref(),
        budget_tokens: Some(bundle.budget_tokens),
        retry_hint: opts.retry_hint.as_deref(),
        phrase_bias: Some(bundle.phrase_bias.as_str()),
        notes: bundle.notes.clone(),
        attachments: opts.attachments.iter().filter(|a| !a.text.trim().is_empty()).map(|a| (a.name.clone(), a.text.clone())).collect(),
    })
}

/// 阶段 2C：词语偏置渲染成一段要求（没有就空串）
fn render_phrase_bias(list: &[crate::models::PhraseBias]) -> String {
    let pick = |k: &str| list.iter().filter(|p| p.kind == k).map(|p| p.phrase.as_str()).collect::<Vec<_>>();
    let (ban, prefer) = (pick("ban"), pick("prefer"));
    let mut out = Vec::new();
    if !ban.is_empty() {
        out.push(format!("不要使用这些表达（AI 腔）：{}", ban.join("、")));
    }
    if !prefer.is_empty() {
        out.push(format!("合适时可以多用：{}", prefer.join("、")));
    }
    out.join("\n")
}

// ---------- 阶段 2C：备选词 / token 概率 ----------

/// 此处下一个词的备选（概率）；supported = false 表示服务商不回概率
#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenAlternatives {
    pub supported: bool,
    pub tokens: Vec<TokenAlt>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TokenAlt {
    pub token: String,
    pub prob: f64,
}

/// 组装「只写几个字」的请求：书名提示 + 光标前文尾部（剔除正文指令）
pub fn token_alternatives_request(s: &AppState, chapter_id: i64, before: &str) -> AppResult<StreamReq> {
    let (p, title) = {
        let conn = lock(s)?;
        let ch = repo::chapters::get(&conn, chapter_id)?;
        (provider::resolve(&conn)?, repo::books::get(&conn, ch.book_id)?.title)
    };
    let clean = crate::context::directives::split(before).clean;
    let total = clean.chars().count();
    let tail: String = clean.chars().skip(total.saturating_sub(1500)).collect();
    Ok(StreamReq {
        base_url: p.base_url,
        api_key: p.api_key,
        model: p.model,
        system: crate::context::assembler::write_prompt(&title),
        history: Vec::new(),
        user: format!("【光标前文】\n{tail}\n\n直接接着上面的最后一个字往下写，只写几个字，不换行、不解释。"),
        max_tokens: 4,
        temperature: 1.0,
    })
}

pub async fn ai_token_alternatives_run(s: &AppState, chapter_id: i64, before: &str) -> AppResult<TokenAlternatives> {
    let req = token_alternatives_request(s, chapter_id, before)?;
    Ok(match next_token_alternatives(req, 8).await? {
        Some(list) => TokenAlternatives { supported: true, tokens: list.into_iter().map(|(token, p)| TokenAlt { token, prob: p as f64 }).collect() },
        None => TokenAlternatives { supported: false, tokens: Vec::new() },
    })
}

#[tauri::command]
pub async fn ai_token_alternatives(state: State<'_, AppState>, chapter_id: i64, before: String) -> AppResult<TokenAlternatives> {
    ai_token_alternatives_run(&state, chapter_id, &before).await
}

// ---------- 阶段 2C：附件 / 词语偏置 ----------

/// 附件文本上限（字符数）：读出来就截，免得一份长稿撑爆上下文
pub const ATTACHMENT_READ_MAX_CHARS: usize = 50_000;

/// 读附件：.txt / .md（自动识别编码）与 .docx（取正文文字）
pub fn attachment_read_inner(path: &std::path::Path) -> AppResult<crate::models::AttachmentRead> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    let bytes = std::fs::read(path)?;
    let text = match ext.as_str() {
        "txt" | "md" | "markdown" => crate::porting::import::detect_and_decode(&bytes),
        "docx" => crate::porting::import::docx_to_text(&bytes)?,
        _ => return Err(AppError::Invalid("附件只支持 .txt / .md / .docx".into())),
    };
    let chars = text.chars().count();
    let truncated = chars > ATTACHMENT_READ_MAX_CHARS;
    let text = if truncated { text.chars().take(ATTACHMENT_READ_MAX_CHARS).collect() } else { text };
    Ok(crate::models::AttachmentRead { name, text, chars: chars as i64, truncated })
}

pub fn phrase_bias_list_inner(s: &AppState, book_id: Option<i64>) -> AppResult<Vec<crate::models::PhraseBias>> {
    repo::phrase_bias::list(&*lock(s)?, book_id)
}

pub fn phrase_bias_add_inner(s: &AppState, book_id: Option<i64>, phrase: &str, kind: &str) -> AppResult<bool> {
    let phrase = phrase.trim();
    if phrase.is_empty() || phrase.chars().count() > 50 {
        return Err(AppError::Invalid("词语不能为空，最长 50 字".into()));
    }
    if kind != "ban" && kind != "prefer" {
        return Err(AppError::Invalid(format!("未知类别：{kind}")));
    }
    repo::phrase_bias::add(&*lock(s)?, book_id, phrase, kind)
}

pub fn phrase_bias_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::phrase_bias::delete(&*lock(s)?, id)
}

/// 一键导入常见 AI 腔（已有的跳过）；返回新增条数
pub fn phrase_bias_import_defaults_inner(s: &AppState, book_id: Option<i64>) -> AppResult<i64> {
    let conn = lock(s)?;
    let mut n = 0;
    for p in repo::phrase_bias::DEFAULT_BANS {
        if repo::phrase_bias::add(&conn, book_id, p, "ban")? {
            n += 1;
        }
    }
    Ok(n)
}

#[tauri::command]
pub fn attachment_read(path: String) -> AppResult<crate::models::AttachmentRead> {
    attachment_read_inner(std::path::Path::new(&path))
}
#[tauri::command]
pub fn phrase_bias_list(s: State<AppState>, book_id: Option<i64>) -> AppResult<Vec<crate::models::PhraseBias>> {
    phrase_bias_list_inner(&s, book_id)
}
#[tauri::command]
pub fn phrase_bias_add(s: State<AppState>, book_id: Option<i64>, phrase: String, kind: String) -> AppResult<bool> {
    phrase_bias_add_inner(&s, book_id, &phrase, &kind)
}
#[tauri::command]
pub fn phrase_bias_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    phrase_bias_delete_inner(&s, id)
}
#[tauri::command]
pub fn phrase_bias_import_defaults(s: State<AppState>, book_id: Option<i64>) -> AppResult<i64> {
    phrase_bias_import_defaults_inner(&s, book_id)
}

// ---------- 阶段 2B：常驻记忆 / 作者注 / 写作规则 ----------

use crate::repo::settings::{AUTHOR_NOTE, MEMORY_BOOK, MEMORY_VOLUME};

/// 读记忆三件套：本书记忆、章所在卷的记忆、本章作者注（chapter_id 为空时只给本书）
pub fn ai_memory_get_inner(s: &AppState, book_id: i64, chapter_id: Option<i64>) -> AppResult<AiMemory> {
    let conn = lock(s)?;
    let get = |k: String| repo::settings::get(&conn, &k).map(|v| v.unwrap_or_default());
    let mut m = AiMemory { book: get(format!("{MEMORY_BOOK}{book_id}"))?, ..Default::default() };
    if let Some(cid) = chapter_id {
        let ch = repo::chapters::get(&conn, cid)?;
        m.chapter_note = get(format!("{AUTHOR_NOTE}{cid}"))?;
        let vol = if ch.kind == "folder" { Some(ch.clone()) } else { ch.parent_id.and_then(|p| repo::chapters::get(&conn, p).ok()) };
        if let Some(v) = vol.filter(|v| v.kind == "folder" && v.deleted_at.is_none()) {
            m.volume = get(format!("{MEMORY_VOLUME}{}", v.id))?;
            m.volume_id = Some(v.id);
            m.volume_title = Some(v.title);
        }
    }
    Ok(m)
}

/// 写记忆：scope = book（id = 书）/ volume（id = 卷）/ chapter（id = 章，作者注）
pub fn ai_memory_set_inner(s: &AppState, scope: &str, id: i64, text: &str) -> AppResult<()> {
    let key = match scope {
        "book" => format!("{MEMORY_BOOK}{id}"),
        "volume" => format!("{MEMORY_VOLUME}{id}"),
        "chapter" => format!("{AUTHOR_NOTE}{id}"),
        _ => return Err(AppError::Invalid(format!("未知的记忆范围：{scope}"))),
    };
    let conn = lock(s)?;
    if text.trim().is_empty() {
        repo::settings::remove(&conn, &key)
    } else {
        repo::settings::set(&conn, &key, text.trim())
    }
}

/// 本轮适用的写作规则：全书常驻 + 作用于本章或本章所在卷 + 本轮手选
fn applicable_rules(rules: &[WritingRule], chapter_id: i64, volume_id: Option<i64>, manual: &[i64]) -> (Vec<String>, String) {
    let mut lines = Vec::new();
    let (mut always, mut scoped, mut picked) = (Vec::new(), Vec::new(), Vec::new());
    for r in rules {
        let hit = match r.mode.as_str() {
            "always" => {
                always.push(r.title.clone());
                true
            }
            "scoped" if r.scope_ids.contains(&chapter_id) || volume_id.is_some_and(|v| r.scope_ids.contains(&v)) => {
                scoped.push(r.title.clone());
                true
            }
            "manual" if manual.contains(&r.id) => {
                picked.push(r.title.clone());
                true
            }
            _ => false,
        };
        if hit {
            lines.push(if r.content.is_empty() { format!("- {}", r.title) } else { format!("- {}：{}", r.title, r.content) });
        }
    }
    let mut why = Vec::new();
    if !always.is_empty() {
        why.push(format!("全书常驻：{}", always.join("、")));
    }
    if !scoped.is_empty() {
        why.push(format!("本章 / 本卷适用：{}", scoped.join("、")));
    }
    if !picked.is_empty() {
        why.push(format!("本轮手选：{}", picked.join("、")));
    }
    (lines, why.join("；"))
}

pub fn rules_list_inner(s: &AppState, book_id: i64) -> AppResult<Vec<WritingRule>> {
    repo::rules::list_by_book(&*lock(s)?, book_id)
}
pub fn rule_upsert_inner(s: &AppState, input: &WritingRuleInput) -> AppResult<WritingRule> {
    repo::rules::upsert(&*lock(s)?, input)
}
pub fn rule_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    repo::rules::delete(&*lock(s)?, id)
}
pub fn card_set_ai_hidden_inner(s: &AppState, kind: &str, id: i64, hidden: bool) -> AppResult<()> {
    repo::rules::set_ai_hidden(&*lock(s)?, kind, id, hidden)
}
pub fn character_set_secret_inner(s: &AppState, id: i64, note: &str) -> AppResult<()> {
    repo::rules::set_secret_note(&*lock(s)?, id, note)
}

#[tauri::command]
pub fn ai_memory_get(s: State<AppState>, book_id: i64, chapter_id: Option<i64>) -> AppResult<AiMemory> {
    ai_memory_get_inner(&s, book_id, chapter_id)
}
#[tauri::command]
pub fn ai_memory_set(s: State<AppState>, scope: String, id: i64, text: String) -> AppResult<()> {
    ai_memory_set_inner(&s, &scope, id, &text)
}
#[tauri::command]
pub fn rules_list(s: State<AppState>, book_id: i64) -> AppResult<Vec<WritingRule>> {
    rules_list_inner(&s, book_id)
}
#[tauri::command]
pub fn rule_upsert(s: State<AppState>, input: WritingRuleInput) -> AppResult<WritingRule> {
    rule_upsert_inner(&s, &input)
}
#[tauri::command]
pub fn rule_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    rule_delete_inner(&s, id)
}
#[tauri::command]
pub fn card_set_ai_hidden(s: State<AppState>, kind: String, id: i64, hidden: bool) -> AppResult<()> {
    card_set_ai_hidden_inner(&s, &kind, id, hidden)
}
#[tauri::command]
pub fn character_set_secret(s: State<AppState>, id: i64, note: String) -> AppResult<()> {
    character_set_secret_inner(&s, id, &note)
}

/// 读会话并收集组装素材：书名 / 激活文风 / 当前章正文（或前端给的光标前文）/
/// 同书 sort_key 前一章整章正文 / 注入原子 / @ 引用 / 会话历史（history_before 之前）。
pub(crate) fn gather_context(
    s: &AppState,
    session_id: i64,
    opts: &AiTurnOptions,
    history_before: Option<i64>,
) -> AppResult<ContextBundle> {
    let (book_id, chapter_id) = {
        let conn = lock(s)?;
        let session = repo::sessions::get(&conn, session_id)?;
        (session.book_id, session.chapter_id)
    };
    let book_title = {
        let conn = lock(s)?;
        repo::books::get(&conn, book_id)?.title
    };
    let style_prompt = {
        let conn = lock(s)?;
        match repo::settings::active_style_id(&conn, book_id)? {
            Some(style_id) => repo::styles::list(&conn)?
                .into_iter()
                .find(|st| st.id == style_id)
                .map(|st| st.prompt_md),
            None => None,
        }
    };
    let (disk_text, prev_rel, prev_title) = {
        let conn = lock(s)?;
        let cur = repo::chapters::get(&conn, chapter_id)?;
        let chapters = repo::chapters::list_by_book(&conn, book_id)?; // 已按 sort_key, id 排序
        let prev_ch = chapters
            .iter()
            .position(|c| c.id == chapter_id)
            .and_then(|i| i.checked_sub(1))
            .map(|i| &chapters[i]);
        let prev = prev_ch.map(|c| c.file_path.clone());
        let prev_title = prev_ch.map(|c| c.title.clone());
        // 卷（卷首语）也能开对话：读卷目录内的 _index.md，未写过则为空
        let text = fs_service::read_chapter(&s.root, &crate::commands::body_rel(&cur)).or_else(|e| {
            if cur.kind == "folder" { Ok(String::new()) } else { Err(e) }
        })?;
        (text, prev, prev_title)
    };
    // 光标感知：前端给了光标前文就以它为准（编辑器里的内容比磁盘新，且续写位置正确）
    let cursor_aware = opts.cursor_before.is_some();
    // 阶段 2C：正文里的 {批注} / [待写指令] 不是正文——从上下文剔除，批注单列（前后文的都算本章批注）
    let before = crate::context::directives::split(&opts.cursor_before.clone().unwrap_or(disk_text));
    let after = opts.cursor_after.as_deref().map(crate::context::directives::split);
    let chapter_text = before.clean;
    let mut notes = before.notes;
    if let Some(a) = &after {
        notes.extend(a.notes.iter().cloned());
    }
    let cursor_after = after.map(|a| a.clean);
    // 前一章整章读入内存，尾部窗口由 assembler::assemble 截取（同样剔除指令）
    let prev_tail = match prev_rel {
        Some(rel) => Some(crate::context::directives::split(&fs_service::read_chapter(&s.root, &rel)?).clean),
        None => None,
    };
    // 注入原子（角色卡关键词命中看整段上下文：光标前后 + 选区）+ @ 引用资料
    let (injections, history) = {
        let conn = lock(s)?;
        let mut scan = chapter_text.clone();
        if let Some(a) = &cursor_after {
            scan.push_str(a);
        }
        let mut injections = inject_ctx::collect(&conn, book_id, Some(chapter_id), &scan)?;
        if let Some(m) = inject_ctx::render_mentions(&conn, &s.root, book_id, &opts.mentions)? {
            injections.push(m);
        }
        let history = repo::sessions::history_for_assembly(&conn, session_id, history_before)?;
        (injections, history)
    };
    // 阶段 2B：常驻记忆（本书 + 所在卷）、作者注、写作规则、预算
    let mem = ai_memory_get_inner(s, book_id, Some(chapter_id))?;
    let mut memory_parts = Vec::new();
    let mut memory_why = Vec::new();
    if !mem.book.trim().is_empty() {
        memory_parts.push(mem.book.trim().to_string());
        memory_why.push("本书常驻记忆".to_string());
    }
    if !mem.volume.trim().is_empty() {
        memory_parts.push(format!("（本卷「{}」）{}", mem.volume_title.clone().unwrap_or_default(), mem.volume.trim()));
        memory_why.push(format!("本卷「{}」记忆", mem.volume_title.clone().unwrap_or_default()));
    }
    let (rules, budget_tokens) = {
        let conn = lock(s)?;
        let all = repo::rules::list_by_book(&conn, book_id)?;
        let (lines, why) = applicable_rules(&all, chapter_id, mem.volume_id, &opts.rules);
        let rules = (!lines.is_empty()).then(|| InjectionInput {
            name: "写作规则".into(),
            source: format!("{} 条", lines.len()),
            text: lines.join("\n"),
            budget: 0,
            reason: why,
        });
        (rules, inject_ctx::load_config(&conn, book_id)?.budget_tokens)
    };
    let phrase_bias = {
        let conn = lock(s)?;
        render_phrase_bias(&repo::phrase_bias::list(&conn, Some(book_id))?)
    };
    Ok(ContextBundle {
        cursor_after,
        phrase_bias,
        notes,
        book_title,
        style_prompt,
        chapter_text,
        prev_tail,
        injections,
        cursor_aware,
        history,
        memory: memory_parts.join("\n"),
        memory_reason: memory_why.join(" + "),
        rules,
        author_note: mem.chapter_note,
        prev_title,
        budget_tokens,
    })
}

/// 回合元信息（落到回答的 meta 里，便于回看与重新生成沿用参数）。
fn turn_meta(opts: &AiTurnOptions, extra: Option<(&str, &str)>) -> String {
    let mut v = serde_json::json!({ "mode": Mode::parse(opts.mode.as_deref()).as_str() });
    if let Some(c) = &opts.command {
        v["command"] = serde_json::Value::String(c.clone());
    }
    if let Some(n) = opts.target_chars {
        v["target_chars"] = serde_json::Value::from(n);
    }
    if let Some(n) = opts.candidates.filter(|n| *n > 1) {
        v["candidates"] = serde_json::Value::from(n);
    }
    if let Some(h) = opts.retry_hint.as_deref().filter(|h| !h.trim().is_empty()) {
        v["retry"] = serde_json::Value::String(h.to_string());
    }
    if !opts.attachments.is_empty() {
        v["attachments"] = serde_json::json!(opts.attachments.iter().map(|a| a.name.clone()).collect::<Vec<_>>());
    }
    if let Some((k, val)) = extra {
        v[k] = serde_json::Value::String(val.to_string());
    }
    v.to_string()
}

// ---------- 阶段 2B：会话置顶 / 归档 / 分叉 / 搜索，收藏回答 ----------

pub fn session_set_pinned_inner(s: &AppState, id: i64, pinned: bool) -> AppResult<ChatSession> {
    repo::sessions::set_pinned(&*lock(s)?, id, pinned)
}
pub fn session_set_archived_inner(s: &AppState, id: i64, archived: bool) -> AppResult<ChatSession> {
    repo::sessions::set_archived(&*lock(s)?, id, archived)
}
pub fn session_fork_inner(s: &AppState, session_id: i64, upto_message_id: i64) -> AppResult<ChatSession> {
    let conn = lock(s)?;
    let tx = conn.unchecked_transaction()?;
    let forked = repo::sessions::fork(&tx, session_id, upto_message_id)?;
    tx.commit()?;
    Ok(forked)
}
pub fn sessions_search_inner(s: &AppState, book_id: i64, query: &str) -> AppResult<Vec<SessionHit>> {
    let conn = lock(s)?;
    let hits = repo::sessions::search(&conn, book_id, query)?;
    Ok(hits
        .into_iter()
        .map(|(session, message_id, snippet)| SessionHit {
            chapter_title: repo::chapters::get(&conn, session.chapter_id).map(|c| c.title).unwrap_or_default(),
            session,
            message_id,
            snippet,
        })
        .collect())
}
/// 收藏回答：标记 starred；收藏时同时存进素材库（分类「AI 收藏」，标签 = 章名），返回素材 id
pub fn message_star_inner(s: &AppState, id: i64, starred: bool) -> AppResult<Option<i64>> {
    let conn = lock(s)?;
    let m = repo::sessions::set_starred(&conn, id, starred)?;
    if !starred {
        return Ok(None);
    }
    let session = repo::sessions::get(&conn, m.session_id)?;
    let chapter = repo::chapters::get(&conn, session.chapter_id).map(|c| c.title).unwrap_or_default();
    let title: String = m.content.chars().filter(|c| !c.is_whitespace() && *c != '#' && *c != '*').take(18).collect();
    let mat = repo::materials::upsert(
        &conn,
        &MaterialInput { id: None, title: if title.is_empty() { "AI 收藏".into() } else { title }, category: "AI 收藏".into(), content: m.content.clone(), tags: chapter },
    )?;
    Ok(Some(mat.id))
}

// ---------- 阶段 2B：一次性生成（抽取设定卡 / 内联改写 / 光标处续写浮条），不落进对话历史 ----------

fn extract_prompt(kind: &str) -> AppResult<&'static str> {
    match kind {
        "character" => Ok("从文本里找出出场或提到的人物。只输出 JSON 数组，每项 {\"name\":\"姓名\",\"role\":\"身份或定位\",\"aliases\":\"别名，逗号分隔\",\"description\":\"一两句小传\"}；没有就输出 []。"),
        "foreshadow" => Ok("从文本里找出埋下的伏笔或悬念。只输出 JSON 数组，每项 {\"title\":\"伏笔名\",\"note\":\"内容与打算如何回收\"}；没有就输出 []。"),
        "plot" => Ok("把文本里的剧情要点拆成情节块。只输出 JSON 数组，每项 {\"content\":\"一句话情节\"}；没有就输出 []。"),
        _ => Err(AppError::Invalid(format!("不支持的抽取类型：{kind}"))),
    }
}

/// 一次性生成的请求组装：抽取走专用提示；改写 / 续写复用完整的上下文管线（记忆、规则、设定卡、前情），
/// 但不带对话历史、不落库。
pub fn transient_request(s: &AppState, task: &TransientTask) -> AppResult<StreamReq> {
    match task.kind.as_str() {
        // 阶段 2C：近义词 / 成语替换——给出这句话里可替换的说法（只出 JSON 字符串数组）
        "synonyms" => {
            let p = {
                let conn = lock(s)?;
                provider::resolve(&conn)?
            };
            if task.selection.trim().is_empty() {
                return Err(AppError::Invalid("先选中要换的词".into()));
            }
            Ok(StreamReq {
                base_url: p.base_url,
                api_key: p.api_key,
                model: p.model,
                system: "你是中文小说写作的词语顾问。只输出 JSON 数组。".into(),
                history: Vec::new(),
                user: format!(
                    "句子：{}\n要替换的词：「{}」\n给出 8 个在这句话里语义贴切、语气一致的替换说法（近义词、成语或更有画面感的表达），不要重复原词。只输出 JSON 字符串数组。",
                    task.text.trim(),
                    task.selection.trim()
                ),
                max_tokens: p.max_tokens.min(400),
                temperature: task.temperature.unwrap_or(0.8),
            })
        }
        "extract" => {
            let p = {
                let conn = lock(s)?;
                provider::resolve(&conn)?
            };
            Ok(StreamReq {
                base_url: p.base_url,
                api_key: p.api_key,
                model: p.model,
                system: format!("你是小说设定的信息抽取助手。{}", extract_prompt(&task.extract_kind)?),
                history: Vec::new(),
                user: task.text.clone(),
                max_tokens: p.max_tokens,
                temperature: task.temperature.unwrap_or(0.2),
            })
        }
        "inline_edit" | "continue" => {
            let chapter_id = task.chapter_id.ok_or_else(|| AppError::Invalid("缺少章节".into()))?;
            let session = get_or_create_session_inner(s, chapter_id)?;
            let mut opts = AiTurnOptions {
                mode: Some("write".into()),
                cursor_before: Some(task.before.clone()),
                cursor_after: Some(task.after.clone()).filter(|a| !a.trim().is_empty()),
                disabled_slots: vec!["对话历史".into()],
                target_chars: task.target_chars,
                temperature: task.temperature,
                ..Default::default()
            };
            let instruction = if task.kind == "inline_edit" {
                if task.selection.trim().is_empty() {
                    return Err(AppError::Invalid("先选中要改的段落".into()));
                }
                opts.selection = Some(task.selection.clone());
                format!("按要求改写选中段落：{}\n只输出改写后的段落，不要解释。", task.instruction.trim())
            } else if task.instruction.trim().is_empty() {
                "接着光标处往下写，保持人称与节奏，直接输出正文。".to_string()
            } else {
                task.instruction.clone()
            };
            let bundle = gather_context(s, session.id, &opts, Some(0))?;
            build_req(s, assemble_with(&bundle, &instruction, &opts), &opts)
        }
        other => Err(AppError::Invalid(format!("未知的生成类型：{other}"))),
    }
}

/// 跑一次性生成：增量经 `transient://{request_id}` 推给前端，结束返回全文；
/// 取消走 cancel_generation(request_id)（已收到的部分照常返回）。
pub async fn ai_transient_run(app: &tauri::AppHandle, s: &AppState, request_id: i64, task: TransientTask) -> AppResult<String> {
    let req = transient_request(s, &task)?;
    let cancel_rx = register_cancel(s, request_id)?;
    let mut rx = chat_stream(req, request_id, cancel_rx).await?;
    let mut out = String::new();
    let result = loop {
        match rx.recv().await {
            Some(StreamEvent::Delta { text }) => {
                out.push_str(&text);
                let _ = app.emit(&format!("transient://{request_id}"), StreamEvent::Delta { text });
            }
            Some(StreamEvent::Done { content, .. }) => break Ok(content),
            Some(StreamEvent::Error { message, partial, .. }) => {
                break if partial.trim().is_empty() { Err(AppError::Invalid(message)) } else { Ok(partial) };
            }
            None => break Ok(out),
        }
    };
    remove_cancel(app, request_id);
    result
}

#[tauri::command]
pub async fn ai_transient(app: tauri::AppHandle, state: State<'_, AppState>, request_id: i64, task: TransientTask) -> AppResult<String> {
    ai_transient_run(&app, &state, request_id, task).await
}
#[tauri::command]
pub fn session_set_pinned(s: State<AppState>, id: i64, pinned: bool) -> AppResult<ChatSession> {
    session_set_pinned_inner(&s, id, pinned)
}
#[tauri::command]
pub fn session_set_archived(s: State<AppState>, id: i64, archived: bool) -> AppResult<ChatSession> {
    session_set_archived_inner(&s, id, archived)
}
#[tauri::command]
pub fn session_fork(s: State<AppState>, session_id: i64, upto_message_id: i64) -> AppResult<ChatSession> {
    session_fork_inner(&s, session_id, upto_message_id)
}
#[tauri::command]
pub fn sessions_search(s: State<AppState>, book_id: i64, query: String) -> AppResult<Vec<SessionHit>> {
    sessions_search_inner(&s, book_id, &query)
}
// ---------- 阶段 2C：评分 / 导出 ----------

pub fn message_rate_inner(s: &AppState, id: i64, rating: i64) -> AppResult<ChatMessage> {
    repo::sessions::set_rating(&*lock(s)?, id, rating)
}

pub fn rating_stats_inner(s: &AppState) -> AppResult<Vec<crate::models::RatingStat>> {
    repo::sessions::rating_stats(&*lock(s)?)
}

/// 把文本写到用户在保存对话框里选的位置（只允许 .md / .txt，导出对话用）
pub fn export_text_file_inner(dest: &std::path::Path, content: &str) -> AppResult<()> {
    let ext = dest.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    if ext != "md" && ext != "txt" {
        return Err(AppError::Invalid("只能导出为 .md 或 .txt".into()));
    }
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(dest, content)?;
    Ok(())
}

#[tauri::command]
pub fn message_rate(s: State<AppState>, id: i64, rating: i64) -> AppResult<ChatMessage> {
    message_rate_inner(&s, id, rating)
}

#[tauri::command]
pub fn rating_stats(s: State<AppState>) -> AppResult<Vec<crate::models::RatingStat>> {
    rating_stats_inner(&s)
}

#[tauri::command]
pub fn export_text_file(dest: String, content: String) -> AppResult<()> {
    export_text_file_inner(std::path::Path::new(&dest), &content)
}

#[tauri::command]
pub fn message_star(s: State<AppState>, id: i64, starred: bool) -> AppResult<Option<i64>> {
    message_star_inner(&s, id, starred)
}

/// 测试用：回合 meta 的拼装结果
pub fn turn_meta_for_test(opts: &AiTurnOptions) -> String {
    turn_meta(opts, None)
}

/// 一次生成的准备产物：针对哪条 user 消息、发给模型的请求、取消信号。
pub struct PreparedTurn {
    pub user_msg: ChatMessage,
    pub req: StreamReq,
    pub cancel_rx: watch::Receiver<bool>,
    pub meta: String,
}

fn build_req(s: &AppState, assembled: Assembled, opts: &AiTurnOptions) -> AppResult<StreamReq> {
    let p = {
        let conn = lock(s)?;
        provider::resolve_for(&conn, opts.provider_id)?
    };
    Ok(StreamReq {
        base_url: p.base_url,
        api_key: p.api_key,
        model: p.model,
        system: assembled.system,
        history: assembled.history,
        user: assembled.user,
        max_tokens: p.max_tokens,
        temperature: opts.temperature.unwrap_or(p.temperature),
    })
}

fn register_cancel(s: &AppState, session_id: i64) -> AppResult<watch::Receiver<bool>> {
    let (tx, rx) = watch::channel(false);
    s.cancels
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .insert(session_id, tx);
    Ok(rx)
}

/// 新一轮：组装（历史 = 此前全部）+ 落库 user 消息 + 构建 StreamReq + 登记取消信号。
/// 服务商未配置等校验在落库前完成——失败时不留下孤立的问题。
pub fn send_prepare(
    s: &AppState,
    session_id: i64,
    instruction: &str,
    opts: &AiTurnOptions,
) -> AppResult<PreparedTurn> {
    {
        let conn = lock(s)?;
        provider::resolve_for(&conn, opts.provider_id)?;
    }
    let bundle = gather_context(s, session_id, opts, None)?;
    let assembled = assemble_with(&bundle, instruction, opts);
    let req = build_req(s, assembled, opts)?;
    let user_msg = {
        let conn = lock(s)?;
        let m = repo::sessions::append_message(&conn, session_id, "user", instruction)?;
        repo::sessions::touch(&conn, session_id)?;
        auto_title(&conn, session_id, instruction)?;
        m
    };
    let cancel_rx = register_cancel(s, session_id)?;
    Ok(PreparedTurn { user_msg, req, cancel_rx, meta: turn_meta(opts, None) })
}

/// 重新生成：针对已有 user 消息，历史只取它之前的，指令沿用其原文；新回答成为新版本。
pub fn regenerate_prepare(s: &AppState, user_message_id: i64, opts: &AiTurnOptions) -> AppResult<PreparedTurn> {
    let user_msg = {
        let conn = lock(s)?;
        repo::sessions::get_message(&conn, user_message_id)?
    };
    if user_msg.role != "user" {
        return Err(AppError::Invalid("只能针对用户消息重新生成".into()));
    }
    let bundle = gather_context(s, user_msg.session_id, opts, Some(user_msg.id))?;
    let assembled = assemble_with(&bundle, &user_msg.content, opts);
    let req = build_req(s, assembled, opts)?;
    {
        let conn = lock(s)?;
        repo::sessions::touch(&conn, user_msg.session_id)?;
    }
    let cancel_rx = register_cancel(s, user_msg.session_id)?;
    Ok(PreparedTurn { meta: turn_meta(opts, None), user_msg, req, cancel_rx })
}

/// 编辑重发：改写 user 消息原文，其后的对话全部作废，再针对它重新生成。
pub fn edit_resend_prepare(
    s: &AppState,
    user_message_id: i64,
    content: &str,
    opts: &AiTurnOptions,
) -> AppResult<PreparedTurn> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::Invalid("消息不能为空".into()));
    }
    {
        let conn = lock(s)?;
        provider::resolve_for(&conn, opts.provider_id)?;
        let msg = repo::sessions::get_message(&conn, user_message_id)?;
        if msg.role != "user" {
            return Err(AppError::Invalid("只能编辑用户消息".into()));
        }
        repo::sessions::update_message(&conn, user_message_id, content)?;
        repo::sessions::delete_after(&conn, msg.session_id, user_message_id)?;
    }
    regenerate_prepare(s, user_message_id, opts)
}

/// 会话标题仍是默认值（「章名 · AI」）时，用第一句话自动命名（≤ 18 字）。
fn auto_title(conn: &rusqlite::Connection, session_id: i64, instruction: &str) -> AppResult<()> {
    let session = repo::sessions::get(conn, session_id)?;
    if !session.title.ends_with(" · AI") && session.title != "新对话" {
        return Ok(());
    }
    let first: String = instruction
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .unwrap_or("")
        .chars()
        .take(18)
        .collect();
    if !first.is_empty() {
        repo::sessions::rename(conn, session_id, &first)?;
    }
    Ok(())
}

fn remove_cancel(app: &tauri::AppHandle, session_id: i64) {
    if let Ok(mut cancels) = app.state::<AppState>().cancels.lock() {
        cancels.remove(&session_id);
    }
}

/// 流式事件经 `emit("stream://{session_id}")` 推前端。Delta 原样转发；
/// Done 先把回答作为新版本落库再 emit；Error 时若已收到部分内容，半截也落库
/// （meta 标 truncated + 错误类别），不让网络抖动吞掉已生成的上千字。
fn spawn_stream(app: &tauri::AppHandle, turn: PreparedTurn) {
    let PreparedTurn { user_msg, req, cancel_rx, meta } = turn;
    let session_id = user_msg.session_id;
    let reply_to = user_msg.id;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut rx = match chat_stream(req, session_id, cancel_rx).await {
            Ok(rx) => rx,
            Err(e) => {
                let message = e.to_string();
                let kind = classify_error(&message).to_string();
                let _ = app.emit(
                    &format!("stream://{session_id}"),
                    StreamEvent::Error { message, kind, partial: String::new() },
                );
                remove_cancel(&app, session_id);
                return;
            }
        };
        while let Some(ev) = rx.recv().await {
            match &ev {
                StreamEvent::Done { content, .. } => {
                    let saved = {
                        let state = app.state::<AppState>();
                        lock(&state).and_then(|conn| {
                            repo::sessions::append_reply(&conn, session_id, reply_to, content, &meta)
                        })
                    };
                    if let Err(e) = saved {
                        // 落库失败：发 Error 且不发 Done，避免前端刷新丢内容
                        let _ = app.emit(
                            &format!("stream://{session_id}"),
                            StreamEvent::Error { message: e.to_string(), kind: "unknown".into(), partial: content.clone() },
                        );
                        continue;
                    }
                }
                StreamEvent::Error { partial, kind, .. } if !partial.trim().is_empty() => {
                    let truncated_meta = {
                        let mut v: serde_json::Value = serde_json::from_str(&meta).unwrap_or_default();
                        v["truncated"] = serde_json::Value::Bool(true);
                        v["error"] = serde_json::Value::String(kind.clone());
                        v.to_string()
                    };
                    let state = app.state::<AppState>();
                    let _ = lock(&state).and_then(|conn| {
                        repo::sessions::append_reply(&conn, session_id, reply_to, partial, &truncated_meta)
                    });
                }
                _ => {}
            }
            let _ = app.emit(&format!("stream://{session_id}"), &ev);
        }
        remove_cancel(&app, session_id);
    });
}

/// user 消息落库后立即返回；生成在后台流式进行。
pub fn send_message_inner(
    app: &tauri::AppHandle,
    s: &AppState,
    session_id: i64,
    instruction: &str,
    opts: &AiTurnOptions,
) -> AppResult<ChatMessage> {
    let turn = send_prepare(s, session_id, instruction, opts)?;
    let user_msg = turn.user_msg.clone();
    spawn_stream(app, turn);
    Ok(user_msg)
}

pub fn regenerate_inner(
    app: &tauri::AppHandle,
    s: &AppState,
    user_message_id: i64,
    opts: &AiTurnOptions,
) -> AppResult<ChatMessage> {
    let turn = regenerate_prepare(s, user_message_id, opts)?;
    let user_msg = turn.user_msg.clone();
    spawn_stream(app, turn);
    Ok(user_msg)
}

pub fn edit_resend_inner(
    app: &tauri::AppHandle,
    s: &AppState,
    user_message_id: i64,
    content: &str,
    opts: &AiTurnOptions,
) -> AppResult<ChatMessage> {
    let turn = edit_resend_prepare(s, user_message_id, content, opts)?;
    let user_msg = turn.user_msg.clone();
    spawn_stream(app, turn);
    Ok(user_msg)
}

/// 幂等：对未知 / 已结束的 session 返回 Ok。
pub fn cancel_generation_inner(s: &AppState, session_id: i64) -> AppResult<()> {
    let tx = {
        let mut cancels = s.cancels.lock().map_err(|_| AppError::LockPoisoned)?;
        cancels.remove(&session_id)
    };
    if let Some(tx) = tx {
        let _ = tx.send(true);
    }
    Ok(())
}

/// 与 send 相同的组装路径，但不调 LLM、不落库，仅返回组装日志（含本轮关闭的槽位）。
pub fn preview_context_inner(
    s: &AppState,
    session_id: i64,
    instruction: &str,
    opts: &AiTurnOptions,
) -> AppResult<AssemblyLog> {
    let bundle = gather_context(s, session_id, opts, None)?;
    Ok(assemble_with(&bundle, instruction, opts).log)
}

// ---------- Provider ----------

pub fn list_providers_inner(s: &AppState) -> AppResult<Vec<ProviderProfile>> {
    let conn = lock(s)?;
    repo::settings::providers(&conn)
}

pub fn save_provider_inner(s: &AppState, p: ProviderProfile) -> AppResult<ProviderProfile> {
    let conn = lock(s)?;
    repo::settings::save_provider(&conn, &p)
}

pub fn delete_provider_inner(s: &AppState, id: i64) -> AppResult<()> {
    let conn = lock(s)?;
    repo::settings::delete_provider(&conn, id)
}

pub fn set_active_provider_inner(s: &AppState, id: i64) -> AppResult<()> {
    let conn = lock(s)?;
    repo::settings::set_active_provider(&conn, id)
}

pub fn get_active_provider_inner(s: &AppState) -> AppResult<Option<i64>> {
    let conn = lock(s)?;
    repo::settings::active_provider_id(&conn)
}

// ---------- Styles ----------

pub fn list_styles_inner(s: &AppState) -> AppResult<Vec<StyleCard>> {
    let conn = lock(s)?;
    repo::styles::list(&conn)
}

/// id=0 新增，否则更新。
pub fn save_style_inner(
    s: &AppState,
    id: i64,
    name: &str,
    prompt_md: &str,
    sample_md: &str,
    tags: &str,
) -> AppResult<StyleCard> {
    let conn = lock(s)?;
    if id == 0 {
        repo::styles::create(&conn, name, prompt_md, sample_md, tags)
    } else {
        repo::styles::update(&conn, id, name, prompt_md, sample_md, tags)
    }
}

pub fn delete_style_inner(s: &AppState, id: i64) -> AppResult<()> {
    let conn = lock(s)?;
    repo::styles::delete(&conn, id)
}

pub fn set_active_style_inner(s: &AppState, book_id: i64, style_id: i64) -> AppResult<()> {
    let conn = lock(s)?;
    repo::settings::set_active_style(&conn, book_id, style_id)
}

/// 当前书的激活文风位（未设置或为 0 均表示「无文风」）。
pub fn get_active_style_inner(s: &AppState, book_id: i64) -> AppResult<Option<i64>> {
    let conn = lock(s)?;
    repo::settings::active_style_id(&conn, book_id)
}

// ---------- Sessions & messages ----------

/// 会话列表：最近使用的在前（阶段 2A）。
pub fn list_sessions_inner(s: &AppState, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    let conn = lock(s)?;
    repo::sessions::list_recent_by_chapter(&conn, chapter_id)
}

/// 新建会话（阶段 2A：一章多会话），标题默认「新对话」，首句后自动命名。
pub fn session_create_inner(s: &AppState, chapter_id: i64) -> AppResult<ChatSession> {
    let conn = lock(s)?;
    let ch = repo::chapters::get(&conn, chapter_id)?;
    repo::sessions::create(&conn, chapter_id, ch.book_id, "新对话")
}

pub fn session_rename_inner(s: &AppState, id: i64, title: &str) -> AppResult<ChatSession> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("会话名不能为空".into()));
    }
    let conn = lock(s)?;
    repo::sessions::rename(&conn, id, title)
}

pub fn session_delete_inner(s: &AppState, id: i64) -> AppResult<()> {
    cancel_generation_inner(s, id)?;
    let conn = lock(s)?;
    repo::sessions::delete(&conn, id)
}

/// 编辑问题并截断其后对话（不生成；随后由前端按当前后端调重新生成）。
pub fn chat_edit_truncate_inner(s: &AppState, user_message_id: i64, content: &str) -> AppResult<ChatMessage> {
    let content = content.trim();
    if content.is_empty() {
        return Err(AppError::Invalid("消息不能为空".into()));
    }
    let conn = lock(s)?;
    let msg = repo::sessions::get_message(&conn, user_message_id)?;
    if msg.role != "user" {
        return Err(AppError::Invalid("只能编辑用户消息".into()));
    }
    repo::sessions::update_message(&conn, user_message_id, content)?;
    repo::sessions::delete_after(&conn, msg.session_id, user_message_id)?;
    repo::sessions::get_message(&conn, user_message_id)
}

/// 切换某条回答为选用版本（历史组装随之改用它）。
pub fn message_set_active_inner(s: &AppState, id: i64) -> AppResult<ChatMessage> {
    let conn = lock(s)?;
    repo::sessions::set_active(&conn, id)
}

pub fn message_set_adopted_inner(s: &AppState, id: i64, adopted: bool) -> AppResult<ChatMessage> {
    let conn = lock(s)?;
    repo::sessions::set_adopted(&conn, id, adopted)
}

/// 该章唯一会话，标题 =「章节名 · AI」。
pub fn get_or_create_session_inner(s: &AppState, chapter_id: i64) -> AppResult<ChatSession> {
    let conn = lock(s)?;
    let ch = repo::chapters::get(&conn, chapter_id)?;
    repo::sessions::get_or_create(&conn, chapter_id, ch.book_id, &format!("{} · AI", ch.title))
}

pub fn list_messages_inner(s: &AppState, session_id: i64) -> AppResult<Vec<ChatMessage>> {
    let conn = lock(s)?;
    repo::sessions::list_messages(&conn, session_id)
}

pub fn delete_message_inner(s: &AppState, id: i64) -> AppResult<()> {
    let conn = lock(s)?;
    repo::sessions::delete_message(&conn, id)
}

// ---- Tauri 薄包装 ----

#[tauri::command]
pub fn list_providers(s: State<AppState>) -> AppResult<Vec<ProviderProfile>> {
    list_providers_inner(&s)
}

#[tauri::command]
pub fn save_provider(s: State<AppState>, p: ProviderProfile) -> AppResult<ProviderProfile> {
    save_provider_inner(&s, p)
}

#[tauri::command]
pub fn delete_provider(s: State<AppState>, id: i64) -> AppResult<()> {
    delete_provider_inner(&s, id)
}

#[tauri::command]
pub fn set_active_provider(s: State<AppState>, id: i64) -> AppResult<()> {
    set_active_provider_inner(&s, id)
}

#[tauri::command]
pub fn get_active_provider(s: State<AppState>) -> AppResult<Option<i64>> {
    get_active_provider_inner(&s)
}

#[tauri::command]
pub fn list_styles(s: State<AppState>) -> AppResult<Vec<StyleCard>> {
    list_styles_inner(&s)
}

#[tauri::command]
pub fn save_style(
    s: State<AppState>,
    id: i64,
    name: String,
    prompt_md: String,
    sample_md: String,
    tags: String,
) -> AppResult<StyleCard> {
    save_style_inner(&s, id, &name, &prompt_md, &sample_md, &tags)
}

#[tauri::command]
pub fn delete_style(s: State<AppState>, id: i64) -> AppResult<()> {
    delete_style_inner(&s, id)
}

#[tauri::command]
pub fn set_active_style(s: State<AppState>, book_id: i64, style_id: i64) -> AppResult<()> {
    set_active_style_inner(&s, book_id, style_id)
}

#[tauri::command]
pub fn get_active_style(s: State<AppState>, book_id: i64) -> AppResult<Option<i64>> {
    get_active_style_inner(&s, book_id)
}

#[tauri::command]
pub fn list_sessions(s: State<AppState>, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    list_sessions_inner(&s, chapter_id)
}

#[tauri::command]
pub fn get_or_create_session(s: State<AppState>, chapter_id: i64) -> AppResult<ChatSession> {
    get_or_create_session_inner(&s, chapter_id)
}

#[tauri::command]
pub fn list_messages(s: State<AppState>, session_id: i64) -> AppResult<Vec<ChatMessage>> {
    list_messages_inner(&s, session_id)
}

#[tauri::command]
pub fn delete_message(s: State<AppState>, id: i64) -> AppResult<()> {
    delete_message_inner(&s, id)
}

#[tauri::command]
pub async fn send_message(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: i64,
    instruction: String,
    options: Option<AiTurnOptions>,
) -> AppResult<ChatMessage> {
    send_message_inner(&app, &state, session_id, &instruction, &options.unwrap_or_default())
}

#[tauri::command]
pub async fn chat_regenerate(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    user_message_id: i64,
    options: Option<AiTurnOptions>,
) -> AppResult<ChatMessage> {
    regenerate_inner(&app, &state, user_message_id, &options.unwrap_or_default())
}

#[tauri::command]
pub async fn chat_edit_resend(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    user_message_id: i64,
    content: String,
    options: Option<AiTurnOptions>,
) -> AppResult<ChatMessage> {
    edit_resend_inner(&app, &state, user_message_id, &content, &options.unwrap_or_default())
}

#[tauri::command]
pub fn chat_edit_truncate(s: State<AppState>, user_message_id: i64, content: String) -> AppResult<ChatMessage> {
    chat_edit_truncate_inner(&s, user_message_id, &content)
}

#[tauri::command]
pub fn session_create(s: State<AppState>, chapter_id: i64) -> AppResult<ChatSession> {
    session_create_inner(&s, chapter_id)
}

#[tauri::command]
pub fn session_rename(s: State<AppState>, id: i64, title: String) -> AppResult<ChatSession> {
    session_rename_inner(&s, id, &title)
}

#[tauri::command]
pub fn session_delete(s: State<AppState>, id: i64) -> AppResult<()> {
    session_delete_inner(&s, id)
}

#[tauri::command]
pub fn message_set_active(s: State<AppState>, id: i64) -> AppResult<ChatMessage> {
    message_set_active_inner(&s, id)
}

#[tauri::command]
pub fn message_set_adopted(s: State<AppState>, id: i64, adopted: bool) -> AppResult<ChatMessage> {
    message_set_adopted_inner(&s, id, adopted)
}

#[tauri::command]
pub fn cancel_generation(s: State<AppState>, session_id: i64) -> AppResult<()> {
    cancel_generation_inner(&s, session_id)
}

#[tauri::command]
pub fn preview_context(
    s: State<AppState>,
    session_id: i64,
    instruction: String,
    options: Option<AiTurnOptions>,
) -> AppResult<AssemblyLog> {
    preview_context_inner(&s, session_id, &instruction, &options.unwrap_or_default())
}

// ---------- 注入原子配置（M7 批次6） ----------

pub fn context_config_get_inner(s: &AppState, book_id: i64) -> AppResult<ContextConfig> {
    inject_ctx::load_config(&*lock(s)?, book_id)
}

pub fn context_config_set_inner(
    s: &AppState,
    book_id: i64,
    config: ContextConfig,
) -> AppResult<ContextConfig> {
    let conn = lock(s)?;
    inject_ctx::store_config(&conn, book_id, &config)?;
    Ok(config)
}

#[tauri::command]
pub fn context_config_get(s: State<AppState>, book_id: i64) -> AppResult<ContextConfig> {
    context_config_get_inner(&s, book_id)
}

#[tauri::command]
pub fn context_config_set(
    s: State<AppState>,
    book_id: i64,
    config: ContextConfig,
) -> AppResult<ContextConfig> {
    context_config_set_inner(&s, book_id, config)
}
