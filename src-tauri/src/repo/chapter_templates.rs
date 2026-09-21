//! M7 批次2：章节模板（chapter_templates）。默认模板在建章时由 commands 层取用。

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{ChapterTemplate, ChapterTemplateInput};

const COLS: &str = "id, book_id, name, content, is_default, created_at, updated_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterTemplate> {
    Ok(ChapterTemplate {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        content: row.get(3)?,
        is_default: row.get::<_, i64>(4)? != 0,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<ChapterTemplate> {
    conn.query_row(
        &format!("SELECT {COLS} FROM chapter_templates WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(AppError::from)
}

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterTemplate>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapter_templates WHERE book_id = ?1 ORDER BY is_default DESC, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 该书的默认模板；无则 None。
pub fn get_default(conn: &Connection, book_id: i64) -> AppResult<Option<ChapterTemplate>> {
    match conn.query_row(
        &format!("SELECT {COLS} FROM chapter_templates WHERE book_id = ?1 AND is_default = 1"),
        [book_id],
        from_row,
    ) {
        Ok(t) => Ok(Some(t)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// id=None 插入；id=Some 更新。name 书内去重；is_default=true 时独占（清掉其他默认）。
pub fn upsert(conn: &Connection, input: &ChapterTemplateInput) -> AppResult<ChapterTemplate> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("模板名不能为空".into()));
    }
    let dup: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM chapter_templates WHERE book_id = ?1 AND name = ?2 AND id != ?3)",
            params![input.book_id, name, input.id.unwrap_or(-1)],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if dup {
        return Err(AppError::Invalid(format!("模板「{name}」已存在")));
    }
    let id = match input.id {
        None => {
            conn.execute(
                "INSERT INTO chapter_templates (book_id, name, content, is_default) VALUES (?1, ?2, ?3, ?4)",
                params![input.book_id, name, input.content, input.is_default],
            )?;
            conn.last_insert_rowid()
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE chapter_templates SET name = ?2, content = ?3, is_default = ?4,
                 updated_at = datetime('now','localtime') WHERE id = ?1",
                params![id, name, input.content, input.is_default],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("模板不存在".into()));
            }
            id
        }
    };
    if input.is_default {
        // 独占默认位（部分唯一索引兜底；先清再立避免约束冲突）
        conn.execute(
            "UPDATE chapter_templates SET is_default = 0 WHERE book_id = ?1 AND id != ?2",
            params![input.book_id, id],
        )?;
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM chapter_templates WHERE id = ?1", [id])?;
    Ok(())
}

/// 设/清默认（None = 清空该书默认位）。
pub fn set_default(conn: &Connection, id: i64, is_default: bool) -> AppResult<ChapterTemplate> {
    let t = get(conn, id)?;
    if is_default {
        conn.execute(
            "UPDATE chapter_templates SET is_default = 0 WHERE book_id = ?1 AND id != ?2",
            params![t.book_id, id],
        )?;
    }
    conn.execute(
        "UPDATE chapter_templates SET is_default = ?2, updated_at = datetime('now','localtime') WHERE id = ?1",
        params![id, is_default],
    )?;
    get(conn, id)
}
