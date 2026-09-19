use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::Idea;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Idea> {
    Ok(Idea {
        id: row.get(0)?,
        content: row.get(1)?,
        words_json: row.get(2)?,
        tags_json: row.get(3)?,
        created_at: row.get(4)?,
    })
}

const COLS: &str = "id, content, words_json, tags_json, created_at";

/// 灵感卡列表（新→旧；同秒按 id 倒序）
pub fn list(conn: &Connection) -> AppResult<Vec<Idea>> {
    let mut stmt =
        conn.prepare(&format!("SELECT {COLS} FROM ideas ORDER BY created_at DESC, id DESC"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn create(conn: &Connection, content: &str, words_json: &str, tags_json: &str) -> AppResult<Idea> {
    conn.execute(
        "INSERT INTO ideas (content, words_json, tags_json) VALUES (?1, ?2, ?3)",
        params![content, words_json, tags_json],
    )?;
    let id = conn.last_insert_rowid();
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM ideas WHERE id = ?1"))?;
    Ok(stmt.query_row(params![id], from_row)?)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM ideas WHERE id = ?1", params![id])?;
    Ok(())
}
