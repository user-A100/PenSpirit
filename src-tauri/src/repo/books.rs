use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::Book;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Book> {
    Ok(Book {
        id: row.get(0)?,
        slug: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
        deleted_at: row.get(5)?,
        orig_dir_name: row.get(6)?,
    })
}

const COLS: &str = "id, slug, title, created_at, updated_at, deleted_at, orig_dir_name";

pub fn list(conn: &Connection) -> AppResult<Vec<Book>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM books WHERE deleted_at IS NULL ORDER BY id"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Book> {
    conn.query_row(&format!("SELECT {COLS} FROM books WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

pub fn get_by_slug(conn: &Connection, slug: &str) -> AppResult<Option<Book>> {
    match conn.query_row(&format!("SELECT {COLS} FROM books WHERE slug = ?1"), [slug], from_row) {
        Ok(b) => Ok(Some(b)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn create(conn: &Connection, title: &str, slug: &str) -> AppResult<Book> {
    conn.execute("INSERT INTO books (slug, title) VALUES (?1, ?2)", params![slug, title])?;
    get(conn, conn.last_insert_rowid())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
    Ok(())
}

// ---- M2-T6 回收站 ----

/// 回收站中的书（删除时间倒序）
pub fn list_deleted(conn: &Connection) -> AppResult<Vec<Book>> {
    let mut stmt =
        conn.prepare(&format!("SELECT {COLS} FROM books WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 软删：目录已移至 trash_slug（如 ".trash_books/shu"），记录原目录名
pub fn soft_delete(conn: &Connection, id: i64, trash_slug: &str, orig_dir_name: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE books SET slug = ?2, orig_dir_name = ?3, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
        params![id, trash_slug, orig_dir_name],
    )?;
    Ok(())
}

/// 恢复：目录已移回 restore_slug（通常为原目录名；冲突时为 -N 新名）
pub fn restore(conn: &Connection, id: i64, restore_slug: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE books SET slug = ?2, orig_dir_name = NULL, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?1",
        params![id, restore_slug],
    )?;
    Ok(())
}
