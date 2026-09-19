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
    })
}

const COLS: &str = "id, slug, title, created_at, updated_at";

pub fn list(conn: &Connection) -> AppResult<Vec<Book>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM books ORDER BY id"))?;
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
