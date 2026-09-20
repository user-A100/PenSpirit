use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Foreshadow, ForeshadowInput};

const COLS: &str = "id, book_id, title, planted_chapter_id, target_chapter_id, status, note, created_at, resolved_chapter_id, override_note, repay_chapter_id";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Foreshadow> {
    Ok(Foreshadow {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        planted_chapter_id: row.get(3)?,
        target_chapter_id: row.get(4)?,
        status: row.get(5)?,
        note: row.get(6)?,
        created_at: row.get(7)?,
        resolved_chapter_id: row.get(8)?,
        override_note: row.get(9)?,
        repay_chapter_id: row.get(10)?,
    })
}

/// 某书的伏笔列表（按登记顺序）
pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<Foreshadow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM foreshadows WHERE book_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn get(conn: &Connection, id: i64) -> AppResult<Foreshadow> {
    conn.query_row(&format!("SELECT {COLS} FROM foreshadows WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// id=None 插入（created_at/status 由 DEFAULT 生成）；id=Some 更新
/// title/planted/target/note（不存在回 NotFound）。标题去空白后不得为空。
pub fn upsert(conn: &Connection, input: &ForeshadowInput) -> AppResult<Foreshadow> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("伏笔标题不能为空".into()));
    }
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO foreshadows (book_id, title, planted_chapter_id, target_chapter_id, note, override_note, repay_chapter_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    input.book_id,
                    title,
                    input.planted_chapter_id,
                    input.target_chapter_id,
                    input.note,
                    input.override_note,
                    input.repay_chapter_id
                ],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE foreshadows
                 SET title = ?2, planted_chapter_id = ?3, target_chapter_id = ?4, note = ?5,
                     override_note = ?6, repay_chapter_id = ?7
                 WHERE id = ?1",
                params![
                    id,
                    title,
                    input.planted_chapter_id,
                    input.target_chapter_id,
                    input.note,
                    input.override_note,
                    input.repay_chapter_id
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("伏笔 #{id} 不存在")));
            }
            get(conn, id)
        }
    }
}

/// 状态流转：status 仅允许 active | resolved | dropped（否则 Invalid）；
/// resolved 必须带 resolved_chapter_id，其它状态一律清 NULL（含传入值）。
pub fn set_status(
    conn: &Connection,
    id: i64,
    status: &str,
    resolved_chapter_id: Option<i64>,
) -> AppResult<Foreshadow> {
    if !matches!(status, "active" | "resolved" | "dropped") {
        return Err(AppError::Invalid(format!("非法的伏笔状态: {status}")));
    }
    let resolved_chapter_id = match (status, resolved_chapter_id) {
        ("resolved", Some(c)) => Some(c),
        ("resolved", None) => {
            return Err(AppError::Invalid("标记回收时必须指定回收章节".into()));
        }
        _ => None,
    };
    let n = conn.execute(
        "UPDATE foreshadows SET status = ?2, resolved_chapter_id = ?3 WHERE id = ?1",
        params![id, status, resolved_chapter_id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("伏笔 #{id} 不存在")));
    }
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM foreshadows WHERE id = ?1", [id])?;
    Ok(())
}
