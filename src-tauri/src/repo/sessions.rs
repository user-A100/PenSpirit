use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::{ChatMessage, ChatSession};

fn session_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatSession> {
    Ok(ChatSession {
        id: row.get(0)?,
        book_id: row.get(1)?,
        chapter_id: row.get(2)?,
        title: row.get(3)?,
        created_at: row.get(4)?,
    })
}

const SESSION_COLS: &str = "id, book_id, chapter_id, title, created_at";
const MESSAGE_COLS: &str = "id, session_id, role, content, created_at";

pub fn list_by_chapter(conn: &Connection, chapter_id: i64) -> AppResult<Vec<ChatSession>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM sessions WHERE chapter_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([chapter_id], session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 该章唯一：已有则返回首个，无则建。
pub fn get_or_create(
    conn: &Connection,
    chapter_id: i64,
    book_id: i64,
    title: &str,
) -> AppResult<ChatSession> {
    if let Some(existing) = list_by_chapter(conn, chapter_id)?.into_iter().next() {
        return Ok(existing);
    }
    conn.execute(
        "INSERT INTO sessions (book_id, chapter_id, title) VALUES (?1, ?2, ?3)",
        params![book_id, chapter_id, title],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {SESSION_COLS} FROM sessions WHERE id = ?1"),
        [id],
        session_from_row,
    )
    .map_err(Into::into)
}

/// 级联删 messages（FK ON DELETE CASCADE + foreign_keys=ON）。
pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM sessions WHERE id = ?1", [id])?;
    Ok(())
}

fn message_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        session_id: row.get(1)?,
        role: row.get(2)?,
        content: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn list_messages(conn: &Connection, session_id: i64) -> AppResult<Vec<ChatMessage>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {MESSAGE_COLS} FROM messages WHERE session_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([session_id], message_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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
    let id = conn.last_insert_rowid();
    conn.query_row(
        &format!("SELECT {MESSAGE_COLS} FROM messages WHERE id = ?1"),
        [id],
        message_from_row,
    )
    .map_err(Into::into)
}

pub fn update_message(conn: &Connection, id: i64, content: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE messages SET content = ?2 WHERE id = ?1",
        params![id, content],
    )?;
    Ok(())
}

pub fn delete_message(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM messages WHERE id = ?1", [id])?;
    Ok(())
}
