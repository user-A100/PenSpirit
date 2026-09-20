use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Character, CharacterInput};

const COLS: &str = "id, book_id, name, role, aliases, description, created_at, updated_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Character> {
    Ok(Character {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        role: row.get(3)?,
        aliases: row.get(4)?,
        description: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<Character> {
    conn.query_row(&format!("SELECT {COLS} FROM characters WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// 某书的人物卡（按创建顺序）
pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<Character>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM characters WHERE book_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// id=None 插入；id=Some 更新（不存在回 NotFound）。姓名去空白后不得为空。
pub fn upsert(conn: &Connection, input: &CharacterInput) -> AppResult<Character> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("人物姓名不能为空".into()));
    }
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO characters (book_id, name, role, aliases, description)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    input.book_id,
                    name,
                    input.role.trim(),
                    input.aliases.trim(),
                    input.description.trim()
                ],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE characters SET name = ?1, role = ?2, aliases = ?3, description = ?4,
                 updated_at = datetime('now','localtime') WHERE id = ?5",
                params![
                    name,
                    input.role.trim(),
                    input.aliases.trim(),
                    input.description.trim(),
                    id
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("人物卡不存在".into()));
            }
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM characters WHERE id = ?1", [id])?;
    Ok(())
}
