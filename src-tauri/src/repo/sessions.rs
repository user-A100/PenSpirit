use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::{ChatMessage, ChatSession};

fn session_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        book_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        created_at: row.get(4)?,
        source: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const SESSION_COLS: &str = "id, book_id, chapter_id, title, created_at, source, updated_at";
const MESSAGE_COLS: &str = "id, session_id, role, content, created_at, reply_to, active, adopted, meta";

/// 按创建先后（最早在前）：get_or_create 取首个，保持 M1 语义。
pub fn list_by_chapter(conn: &Connection, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM sessions WHERE chapter_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([chapter_id], session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 会话列表（阶段 2A）：最近使用的在前。
pub fn list_recent_by_chapter(conn: &Connection, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM sessions WHERE chapter_id = ?1 \
         ORDER BY CASE WHEN updated_at = '' THEN created_at ELSE updated_at END DESC, id DESC"
    ))?;
    let rows = stmt.query_map([chapter_id], session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 按 id 读单个会话（不存在时 NotFound）。
pub fn get(conn: &Connection, id: i64) -> AppResult<ChatSession> {
    conn.query_row(
        &format!("SELECT {SESSION_COLS} FROM sessions WHERE id = ?1"),
        [id],
        session_from_row,
    )
    .map_err(AppError::from)
}

/// 新建会话（阶段 2A：一章可有多个会话）。
pub fn create(conn: &Connection, chapter_id: i64, book_id: i64, title: &str) -> AppResult<ChatSession> {
    conn.execute(
        "INSERT INTO sessions (book_id, chapter_id, title, updated_at) VALUES (?1, ?2, ?3, datetime('now'))",
        params![book_id, chapter_id, title],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// 该章已有会话则返回最早的一个，无则建。
pub fn get_or_create(
    conn: &Connection,
    chapter_id: i64,
    book_id: i64,
    title: &str,
) -> AppResult<ChatSession> {
    if let Some(existing) = list_by_chapter(conn, chapter_id)?.into_iter().next() {
        return Ok(existing);
    }
    create(conn, chapter_id, book_id, title)
}

pub fn rename(conn: &Connection, id: i64, title: &str) -> AppResult<ChatSession> {
    let n = conn.execute("UPDATE sessions SET title = ?2 WHERE id = ?1", params![id, title])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("会话 #{id} 不存在")));
    }
    get(conn, id)
}

/// 记一次使用（会话列表排序用）。
pub fn touch(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?1", [id])?;
    Ok(())
}

/// 级联删 messages（FK ON DELETE CASCADE + foreign_keys=ON）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}

/// 更新会话后端来源标记（'provider' | 'agent:{id}'）。
pub fn update_source(conn: &Connection, id: i64, source: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE sessions SET source = ?2 WHERE id = ?1",
        params![id, source],
    )?;
    Ok(())
}

fn message_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
        reply_to: row.get(5)?,
        active: row.get::<_, i64>(6)? != 0,
        adopted: row.get::<_, i64>(7)? != 0,
        meta: row.get(8)?,
    })
}

pub fn list_messages(conn: &Connection, session_id: i64) -> AppResult<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {MESSAGE_COLS} FROM messages WHERE session_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([session_id], message_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_message(conn: &Connection, id: i64) -> AppResult<ChatMessage> {
    conn.query_row(
        &format!("SELECT {MESSAGE_COLS} FROM messages WHERE id = ?1"),
        [id],
        message_from_row,
    )
    .map_err(AppError::from)
}

pub fn append_message(
    conn: &Connection,
    session_id: i64,
    role: &str,
    content: &str,
) -> AppResult<ChatMessage> {
    conn.execute(
        "INSERT INTO messages (session_id, role, content) VALUES (?1, ?2, ?3)",
        params![session_id, role, content],
    )?;
    get_message(conn, conn.last_insert_rowid())
}

/// 落一条回答（阶段 2A）：同一问题的旧版本全部置为非选用，新版本选用。
pub fn append_reply(
    conn: &Connection,
    session_id: i64,
    reply_to: i64,
    content: &str,
    meta: &str,
) -> AppResult<ChatMessage> {
    conn.execute(
        "UPDATE messages SET active = 0 WHERE reply_to = ?1",
        [reply_to],
    )?;
    conn.execute(
        "INSERT INTO messages (session_id, role, content, reply_to, active, meta) VALUES (?1, 'assistant', ?2, ?3, 1, ?4)",
        params![session_id, content, reply_to, meta],
    )?;
    get_message(conn, conn.last_insert_rowid())
}

/// 切换选用版本：同组其余置为非选用。
pub fn set_active(conn: &Connection, id: i64) -> AppResult<ChatMessage> {
    let msg = get_message(conn, id)?;
    let reply_to = msg
        .reply_to
        .ok_or_else(|| AppError::Invalid("只有 AI 回答可以切换版本".into()))?;
    conn.execute("UPDATE messages SET active = (id = ?2) WHERE reply_to = ?1", params![reply_to, id])?;
    get_message(conn, id)
}

pub fn set_adopted(conn: &Connection, id: i64, adopted: bool) -> AppResult<ChatMessage> {
    conn.execute(
        "UPDATE messages SET adopted = ?2 WHERE id = ?1",
        params![id, adopted as i64],
    )?;
    get_message(conn, id)
}

pub fn update_message(conn: &Connection, id: i64, content: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE messages SET content = ?2 WHERE id = ?1",
        params![id, content],
    )?;
    Ok(())
}

/// 删掉某条消息之后的全部消息（编辑重发：其后的对话作废）。
pub fn delete_after(conn: &Connection, session_id: i64, message_id: i64) -> AppResult<usize> {
    Ok(conn.execute(
        "DELETE FROM messages WHERE session_id = ?1 AND id > ?2",
        params![session_id, message_id],
    )?)
}

pub fn delete_message(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM messages WHERE id = ?1", [id])?;
    Ok(())
}

/// 组装用的对话历史：时间序的用户原话 + 各问题当前选用的回答；
/// before = Some(id) 时只取该消息之前的（重新生成 / 编辑重发）。
pub fn history_for_assembly(
    conn: &Connection,
    session_id: i64,
    before: Option<i64>,
) -> AppResult<Vec<(String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT role, content FROM messages \
         WHERE session_id = ?1 AND id < ?2 AND (role = 'user' OR (role = 'assistant' AND active = 1)) \
         ORDER BY id",
    )?;
    let rows = stmt.query_map(params![session_id, before.unwrap_or(i64::MAX)], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 会话里最近一条 user 消息（编辑/重新生成定位用）。
pub fn last_user_message(conn: &Connection, session_id: i64) -> AppResult<Option<ChatMessage>> {
    conn.query_row(
        &format!("SELECT {MESSAGE_COLS} FROM messages WHERE session_id = ?1 AND role = 'user' ORDER BY id DESC LIMIT 1"),
        [session_id],
        message_from_row,
    )
    .optional()
    .map_err(AppError::from)
}
