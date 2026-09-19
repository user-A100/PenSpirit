use rusqlite::{params, Connection};

use crate::error::AppResult;
use crate::models::BumpWord;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<BumpWord> {
    Ok(BumpWord { id: row.get(0)?, word: row.get(1)?, created_at: row.get(2)? })
}

const COLS: &str = "id, word, created_at";

pub fn list(conn: &Connection) -> AppResult<Vec<BumpWord>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM bump_words ORDER BY id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 加词。重复词幂等：`INSERT OR IGNORE` + 回查，返回已存在的那条
/// （用户重复输入同一个词是常态，不该报错）。
pub fn add(conn: &Connection, word: &str) -> AppResult<BumpWord> {
    conn.execute("INSERT OR IGNORE INTO bump_words (word) VALUES (?1)", params![word])?;
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM bump_words WHERE word = ?1"))?;
    Ok(stmt.query_row(params![word], from_row)?)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM bump_words WHERE id = ?1", params![id])?;
    Ok(())
}

/// 清空词库（示例词不会回来——它们只在迁移里插过一次）
pub fn clear(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM bump_words", [])?;
    Ok(())
}
