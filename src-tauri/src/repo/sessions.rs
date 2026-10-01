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
        pinned: row.get::<_, i64>(7)? != 0,
        archived: row.get::<_, i64>(8)? != 0,
    })
}

const SESSION_COLS: &str = "id, book_id, chapter_id, title, created_at, source, updated_at, pinned, archived";
const MESSAGE_COLS: &str = "id, session_id, role, content, created_at, reply_to, active, adopted, meta, starred, rating";

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
         ORDER BY pinned DESC, CASE WHEN updated_at = '' THEN created_at ELSE updated_at END DESC, id DESC"
    ))?;
    let rows = stmt.query_map([chapter_id], session_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 阶段 2B：置顶 / 归档
pub fn set_pinned(conn: &Connection, id: i64, pinned: bool) -> AppResult<ChatSession> {
    conn.execute("UPDATE sessions SET pinned = ?2 WHERE id = ?1", params![id, pinned as i64])?;
    get(conn, id)
}
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> AppResult<ChatSession> {
    conn.execute("UPDATE sessions SET archived = ?2 WHERE id = ?1", params![id, archived as i64])?;
    get(conn, id)
}

/// 阶段 2B：收藏回答
pub fn set_starred(conn: &Connection, message_id: i64, starred: bool) -> AppResult<ChatMessage> {
    conn.execute("UPDATE messages SET starred = ?2 WHERE id = ?1", params![message_id, starred as i64])?;
    get_message(conn, message_id)
}

/// 阶段 2B：从某条消息处分叉——新会话（同章、同后端）复制到这条为止的对话（含各版本），
/// 分叉点若是某个回答版本，则它在新会话里是选用版本。
pub fn fork(conn: &Connection, session_id: i64, upto_message_id: i64) -> AppResult<ChatSession> {
    let src = get(conn, session_id)?;
    let upto = get_message(conn, upto_message_id)?;
    if upto.session_id != session_id {
        return Err(AppError::Invalid("消息不属于这个会话".into()));
    }
    conn.execute(
        "INSERT INTO sessions (book_id, chapter_id, title, source, updated_at) VALUES (?1, ?2, ?3, ?4, datetime('now'))",
        params![src.book_id, src.chapter_id, format!("{}（分叉）", src.title), src.source],
    )?;
    let new_id = conn.last_insert_rowid();
    let msgs: Vec<ChatMessage> = list_messages(conn, session_id)?.into_iter().filter(|m| m.id <= upto_message_id).collect();
    let mut map = std::collections::HashMap::new();
    for m in &msgs {
        let reply_to = m.reply_to.and_then(|r| map.get(&r).copied());
        let active = if upto.role == "assistant" && m.reply_to.is_some() && m.reply_to == upto.reply_to { m.id == upto.id } else { m.active };
        conn.execute(
            "INSERT INTO messages (session_id, role, content, created_at, reply_to, active, adopted, meta, starred) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
            params![new_id, m.role, m.content, m.created_at, reply_to, active as i64, m.adopted as i64, m.meta],
        )?;
        map.insert(m.id, conn.last_insert_rowid());
    }
    get(conn, new_id)
}

/// 阶段 2B：在书里搜会话——标题或任一消息内容包含关键词；每个会话取第一处命中做摘录
pub fn search(conn: &Connection, book_id: i64, query: &str) -> AppResult<Vec<(ChatSession, Option<i64>, String)>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let like = format!("%{}%", q.replace('%', "").replace('_', ""));
    let mut stmt = conn.prepare(&format!(
        "SELECT {SESSION_COLS} FROM sessions s WHERE s.book_id = ?1 AND (s.title LIKE ?2 OR EXISTS \
         (SELECT 1 FROM messages m WHERE m.session_id = s.id AND m.content LIKE ?2)) \
         ORDER BY CASE WHEN s.updated_at = '' THEN s.created_at ELSE s.updated_at END DESC, s.id DESC LIMIT 50"
    ))?;
    let sessions = stmt.query_map(params![book_id, like], session_from_row)?.collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::new();
    for s in sessions {
        let hit: Option<(i64, String)> = conn
            .query_row(
                "SELECT id, content FROM messages WHERE session_id = ?1 AND content LIKE ?2 ORDER BY id LIMIT 1",
                params![s.id, like],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        let (mid, snippet) = match hit {
            Some((id, content)) => (Some(id), snippet_around(&content, q)),
            None => (None, String::new()),
        };
        out.push((s, mid, snippet));
    }
    Ok(out)
}

/// 命中处前后各约 24 字的摘录
fn snippet_around(text: &str, q: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let lower: String = text.to_lowercase();
    let pos = lower.find(&q.to_lowercase()).map(|b| lower[..b].chars().count()).unwrap_or(0);
    let start = pos.saturating_sub(24);
    let end = (pos + q.chars().count() + 24).min(chars.len());
    let mut s: String = chars[start..end].iter().collect::<String>().replace('\n', " ");
    if start > 0 {
        s.insert(0, '…');
    }
    if end < chars.len() {
        s.push('…');
    }
    s
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
        starred: row.get::<_, i64>(9)? != 0,
        rating: row.get(10)?,
    })
}

/// 阶段 2C：给回答评分（1 / -1 / 0 取消）
pub fn set_rating(conn: &Connection, id: i64, rating: i64) -> AppResult<ChatMessage> {
    conn.execute("UPDATE messages SET rating = ?2 WHERE id = ?1", params![id, rating.clamp(-1, 1)])?;
    get_message(conn, id)
}

/// 阶段 2C：按斜杠命令统计 👍 / 👎（只算带命令的回答）
pub fn rating_stats(conn: &Connection) -> AppResult<Vec<crate::models::RatingStat>> {
    let mut stmt = conn.prepare(
        "SELECT json_extract(meta, '$.command') AS c, SUM(rating = 1), SUM(rating = -1) FROM messages \
         WHERE role = 'assistant' AND rating != 0 AND json_valid(meta) AND json_extract(meta, '$.command') IS NOT NULL \
         GROUP BY c ORDER BY c",
    )?;
    let rows = stmt.query_map([], |r| Ok(crate::models::RatingStat { command: r.get(0)?, up: r.get(1)?, down: r.get(2)? }))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
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

/// 阶段 2B：改写消息 meta（agent 回合的撤销状态等）
pub fn set_meta(conn: &Connection, id: i64, meta: &str) -> AppResult<()> {
    conn.execute("UPDATE messages SET meta = ?2 WHERE id = ?1", params![id, meta])?;
    Ok(())
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
        "SELECT role, content, meta FROM messages \
         WHERE session_id = ?1 AND id < ?2 AND (role = 'user' OR (role = 'assistant' AND active = 1)) \
         ORDER BY id",
    )?;
    let rows = stmt
        .query_map(params![session_id, before.unwrap_or(i64::MAX)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    // 阶段 2B「/压缩」：最近一份压缩摘要代替它之前的全部对话（连同请求压缩的那句）
    if let Some(pos) = rows.iter().rposition(|(role, _, meta)| role == "assistant" && meta.contains("\"command\":\"compact\"")) {
        let mut out = vec![
            ("user".to_string(), "（以下是此前对话的压缩摘要，之前的内容以它为准）".to_string()),
            ("assistant".to_string(), rows[pos].1.clone()),
        ];
        out.extend(rows[pos + 1..].iter().map(|(r, c, _)| (r.clone(), c.clone())));
        return Ok(out);
    }
    Ok(rows.into_iter().map(|(r, c, _)| (r, c)).collect())
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
