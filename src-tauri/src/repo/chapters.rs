use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::ChapterMeta;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterMeta> {
    Ok(ChapterMeta {
        id: row.get(0)?,
        book_id: row.get(1)?,
        file_path: row.get(2)?,
        title: row.get(3)?,
        sort_key: row.get(4)?,
        word_count: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const COLS: &str = "id, book_id, file_path, title, sort_key, word_count, created_at, updated_at";

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapters WHERE book_id = ?1 ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<ChapterMeta> {
    conn.query_row(&format!("SELECT {COLS} FROM chapters WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

pub fn create(conn: &Connection, book_id: i64, file_path: &str, title: &str) -> AppResult<ChapterMeta> {
    let sort_key = conn.query_row(
        "SELECT COALESCE(MAX(sort_key), 0.0) + 1.0 FROM chapters WHERE book_id = ?1",
        [book_id],
        |r| r.get::<_, f64>(0),
    )?;
    conn.execute(
        "INSERT INTO chapters (book_id, file_path, title, sort_key) VALUES (?1, ?2, ?3, ?4)",
        params![book_id, file_path, title, sort_key],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, new_title: &str, new_file_path: &str) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET title = ?2, file_path = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, new_title, new_file_path],
    )?;
    get(conn, id)
}

pub fn touch_content(conn: &Connection, id: i64, word_count: i64) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET word_count = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![id, word_count],
    )?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM chapters WHERE id = ?1", [id])?;
    Ok(())
}

/// 下一个文件名序号：max(现存文件名序号前缀, AUTOINCREMENT 水位) + 1；无记录时 1。只增不减。
/// 前缀扫描防止与现存文件重名；sqlite_sequence 水位在行删除后不回退，
/// 保证「只增不减，避免重名」（该表在首次 AUTOINCREMENT 插入后才存在，缺失视为 0）。
pub fn next_index(conn: &Connection, book_id: i64) -> AppResult<i64> {
    let paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT file_path FROM chapters WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let prefix_max = paths
        .iter()
        .filter_map(|p| {
            p.rsplit('/')
                .next()?
                .split('-')
                .next()?
                .parse::<i64>()
                .ok()
        })
        .max()
        .unwrap_or(0);
    let seq: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'chapters'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(prefix_max.max(seq) + 1)
}
