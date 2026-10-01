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
use crate::llm::stream::{chat_stream, classify_error, StreamEvent, StreamReq};
use crate::models::{AiTurnOptions, ChatMessage, ChatSession, ContextConfig, ProviderProfile, StyleCard};
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
        cursor_after: opts.cursor_after.as_deref(),
        selection: opts.selection.as_deref(),
        history: bundle.history.clone(),
        disabled: opts.disabled_slots.clone(),
        target_chars: opts.target_chars,
    })
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
    let (disk_text, prev_rel) = {
        let conn = lock(s)?;
        let cur = repo::chapters::get(&conn, chapter_id)?;
        let chapters = repo::chapters::list_by_book(&conn, book_id)?; // 已按 sort_key, id 排序
        let prev = chapters
            .iter()
            .position(|c| c.id == chapter_id)
            .and_then(|i| i.checked_sub(1))
            .map(|i| chapters[i].file_path.clone());
        // 卷（卷首语）也能开对话：读卷目录内的 _index.md，未写过则为空
        let text = fs_service::read_chapter(&s.root, &crate::commands::body_rel(&cur)).or_else(|e| {
            if cur.kind == "folder" { Ok(String::new()) } else { Err(e) }
        })?;
        (text, prev)
    };
    // 光标感知：前端给了光标前文就以它为准（编辑器里的内容比磁盘新，且续写位置正确）
    let cursor_aware = opts.cursor_before.is_some();
    let chapter_text = opts.cursor_before.clone().unwrap_or(disk_text);
    // 前一章整章读入内存，尾部窗口由 assembler::assemble 截取
    let prev_tail = match prev_rel {
        Some(rel) => Some(fs_service::read_chapter(&s.root, &rel)?),
        None => None,
    };
    // 注入原子（角色卡关键词命中看整段上下文：光标前后 + 选区）+ @ 引用资料
    let (injections, history) = {
        let conn = lock(s)?;
        let mut scan = chapter_text.clone();
        if let Some(a) = &opts.cursor_after {
            scan.push_str(a);
        }
        let mut injections = inject_ctx::collect(&conn, book_id, Some(chapter_id), &scan)?;
        if let Some(m) = inject_ctx::render_mentions(&conn, &s.root, book_id, &opts.mentions)? {
            injections.push(m);
        }
        let history = repo::sessions::history_for_assembly(&conn, session_id, history_before)?;
        (injections, history)
    };
    Ok(ContextBundle { book_title, style_prompt, chapter_text, prev_tail, injections, cursor_aware, history })
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
    if let Some((k, val)) = extra {
        v[k] = serde_json::Value::String(val.to_string());
    }
    v.to_string()
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
        provider::resolve(&conn)?
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
        provider::resolve(&conn)?;
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
        provider::resolve(&conn)?;
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
