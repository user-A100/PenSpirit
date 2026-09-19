use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::StyleCard;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<StyleCard> {
    Ok(StyleCard {
        id: row.get(0)?,
        name: row.get(1)?,
        prompt_md: row.get(2)?,
        sample_md: row.get(3)?,
        tags: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const COLS: &str = "id, name, prompt_md, sample_md, tags, created_at, updated_at";

pub fn list(conn: &Connection) -> AppResult<Vec<StyleCard>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM styles ORDER BY id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// tags 为 JSON 数组字符串（如 ["仙侠","冷峻"]），仓库层不解析只透传。
pub fn create(
    conn: &Connection,
    name: &str,
    prompt_md: &str,
    sample_md: &str,
    tags: &str,
) -> AppResult<StyleCard> {
    conn.execute(
        "INSERT INTO styles (name, prompt_md, sample_md, tags) VALUES (?1, ?2, ?3, ?4)",
        params![name, prompt_md, sample_md, tags],
    )?;
    let id = conn.last_insert_rowid();
    conn.query_row(&format!("SELECT {COLS} FROM styles WHERE id = ?1"), [id], from_row)
        .map_err(Into::into)
}

pub fn update(
    conn: &Connection,
    id: i64,
    name: &str,
    prompt_md: &str,
    sample_md: &str,
    tags: &str,
) -> AppResult<StyleCard> {
    conn.execute(
        "UPDATE styles SET name = ?2, prompt_md = ?3, sample_md = ?4, tags = ?5, \
         updated_at = datetime('now') WHERE id = ?1",
        params![id, name, prompt_md, sample_md, tags],
    )?;
    conn.query_row(&format!("SELECT {COLS} FROM styles WHERE id = ?1"), [id], from_row)
        .map_err(Into::into)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM styles WHERE id = ?1", [id])?;
    Ok(())
}
