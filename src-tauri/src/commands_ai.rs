//! M1 AI 命令层：Provider / 文风 / 会话 / 流式发送 / 取消 / 上下文预览。
//! 全部走 M0 模式：`*_inner(&AppState)` 可测，`#[tauri::command]` 薄包装。

use tauri::{Emitter, Manager, State};
use tokio::sync::watch;

use crate::context::assembler::{assemble, Assembled, AssembleInput, AssemblyLog};
use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::llm::provider;
use crate::llm::stream::{chat_stream, StreamEvent, StreamReq};
use crate::models::{ChatMessage, ChatSession, ProviderProfile, StyleCard};
use crate::repo;
use crate::state::AppState;

fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    s.db.lock().map_err(|_| AppError::LockPoisoned)
}

/// 组装上下文所需的素材（send 与 preview 共用读取路径）。
struct ContextBundle {
    book_title: String,
    style_prompt: Option<String>,
    chapter_text: String,
    prev_tail: Option<String>,
}

fn assemble_with(bundle: &ContextBundle, instruction: &str) -> Assembled {
    assemble(&AssembleInput {
        book_title: &bundle.book_title,
        style_prompt: bundle.style_prompt.as_deref(),
        chapter_text: &bundle.chapter_text,
        prev_chapter_tail: bundle.prev_tail.as_deref(),
        instruction,
    })
}

/// 读会话并收集组装素材：书名 / 激活文风 prompt_md / 当前章正文 /
/// 同书 sort_key 前一章整章正文（窗口截断交由组装器按字符处理）。
fn gather_context(s: &AppState, session_id: i64) -> AppResult<ContextBundle> {
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
    let (chapter_text, prev_rel) = {
        let conn = lock(s)?;
        let cur = repo::chapters::get(&conn, chapter_id)?;
        let chapters = repo::chapters::list_by_book(&conn, book_id)?; // 已按 sort_key, id 排序
        let prev = chapters
            .iter()
            .position(|c| c.id == chapter_id)
            .and_then(|i| i.checked_sub(1))
            .map(|i| chapters[i].file_path.clone());
        let text = fs_service::read_chapter(&s.root, &cur.file_path)?;
        (text, prev)
    };
    // 前一章整章读入内存，尾部窗口由 assembler::assemble 截取
    let prev_tail = match prev_rel {
        Some(rel) => Some(fs_service::read_chapter(&s.root, &rel)?),
        None => None,
    };
    Ok(ContextBundle { book_title, style_prompt, chapter_text, prev_tail })
}

/// 组装 + 落库 user 消息 + 构建 StreamReq + 登记取消信号。
/// 流式启动（chat_stream）交给 send_message 的后台任务，保证命令立即返回。
pub fn send_prepare(
    s: &AppState,
    session_id: i64,
    instruction: &str,
) -> AppResult<(ChatMessage, StreamReq, watch::Receiver<bool>)> {
    let p = {
        let conn = lock(s)?;
        provider::resolve(&conn)?
    };
    let bundle = gather_context(s, session_id)?;
    let assembled = assemble_with(&bundle, instruction);
    let user_msg = {
        let conn = lock(s)?;
        repo::sessions::append_message(&conn, session_id, "user", instruction)?
    };
    let req = StreamReq {
        base_url: p.base_url,
        api_key: p.api_key,
        model: p.model,
        system: assembled.system,
        history: assembled.history,
        user: assembled.user,
        max_tokens: p.max_tokens,
        temperature: p.temperature,
    };
    let (tx, rx) = watch::channel(false);
    s.cancels
        .lock()
        .map_err(|_| AppError::LockPoisoned)?
        .insert(session_id, tx);
    Ok((user_msg, req, rx))
}

fn remove_cancel(app: &tauri::AppHandle, session_id: i64) {
    if let Ok(mut cancels) = app.state::<AppState>().cancels.lock() {
        cancels.remove(&session_id);
    }
}

/// user 消息落库后立即返回；流式事件经 `emit("stream://{session_id}")` 推前端。
/// Delta 原样转发；Done 先落库 assistant 全文再 emit（事件自带 content）；
/// Error 只 emit 不落库。
pub fn send_message_inner(
    app: &tauri::AppHandle,
    s: &AppState,
    session_id: i64,
    instruction: &str,
) -> AppResult<ChatMessage> {
    let (user_msg, req, cancel_rx) = send_prepare(s, session_id, instruction)?;
    let session_id = user_msg.session_id;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut rx = match chat_stream(req, session_id, cancel_rx).await {
            Ok(rx) => rx,
            Err(e) => {
                let _ = app.emit(
                    &format!("stream://{session_id}"),
                    StreamEvent::Error { message: e.to_string() },
                );
                remove_cancel(&app, session_id);
                return;
            }
        };
        while let Some(ev) = rx.recv().await {
            if let StreamEvent::Done { ref content, .. } = ev {
                let saved = {
                    let state = app.state::<AppState>();
                    lock(&state)
                        .and_then(|conn| {
                            repo::sessions::append_message(&conn, session_id, "assistant", content)
                        })
                };
                if let Err(e) = saved {
                    // 落库失败：发 Error 且不发 Done，避免前端刷新丢内容
                    let _ = app.emit(
                        &format!("stream://{session_id}"),
                        StreamEvent::Error { message: e.to_string() },
                    );
                    continue;
                }
            }
            let _ = app.emit(&format!("stream://{session_id}"), &ev);
        }
        remove_cancel(&app, session_id);
    });
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

/// 与 send 相同的组装路径，但不调 LLM、不落库，仅返回组装日志。
pub fn preview_context_inner(
    s: &AppState,
    session_id: i64,
    instruction: &str,
) -> AppResult<AssemblyLog> {
    let bundle = gather_context(s, session_id)?;
    Ok(assemble_with(&bundle, instruction).log)
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

// ---------- Sessions & messages ----------

pub fn list_sessions_inner(s: &AppState, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    let conn = lock(s)?;
    repo::sessions::list_by_chapter(&conn, chapter_id)
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
) -> AppResult<ChatMessage> {
    send_message_inner(&app, &state, session_id, &instruction)
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
) -> AppResult<AssemblyLog> {
    preview_context_inner(&s, session_id, &instruction)
}
