use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{PlotBlock, PlotBlockInput};

const COLS: &str = "id, book_id, content, status, chapter_id, sort_key, created_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<PlotBlock> {
    Ok(PlotBlock {
        id: row.get(0)?,
        book_id: row.get(1)?,
        content: row.get(2)?,
        status: row.get(3)?,
        chapter_id: row.get(4)?,
        sort_key: row.get(5)?,
        created_at: row.get(6)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<PlotBlock> {
    conn.query_row(&format!("SELECT {COLS} FROM plot_blocks WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// 某书情节块：未用的在前（idea → ready），已用殿后；组内按 sort_key。
/// 「先攒点子再消耗」的工作流下，写作位永远在列表顶部。
pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<PlotBlock>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM plot_blocks WHERE book_id = ?1
         ORDER BY CASE status WHEN 'idea' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END,
                  sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 状态机：idea → ready → used；used → idea（回炉）。chapter_id 仅 used 时有意义。
fn validate(input: &PlotBlockInput) -> AppResult<()> {
    if input.content.trim().is_empty() {
        return Err(AppError::Invalid("情节块内容不能为空".into()));
    }
    if !matches!(input.status.as_str(), "idea" | "ready" | "used") {
        return Err(AppError::Invalid(format!("非法的情节块状态: {}", input.status)));
    }
    Ok(())
}

/// id=None 插入；id=Some 更新（不存在回 NotFound）。
pub fn upsert(conn: &Connection, input: &PlotBlockInput) -> AppResult<PlotBlock> {
    validate(input)?;
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO plot_blocks (book_id, content, status, chapter_id, sort_key)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    input.book_id,
                    input.content.trim(),
                    input.status,
                    input.chapter_id,
                    input.sort_key
                ],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE plot_blocks SET content = ?2, status = ?3, chapter_id = ?4,
                 sort_key = ?5 WHERE id = ?1",
                params![id, input.content.trim(), input.status, input.chapter_id, input.sort_key],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("情节块不存在".into()));
            }
            get(conn, id)
        }
    }
}

/// 批量重排（拖拽后落 sort_key）：传入有序 id 列表，按位写 sort_key。
/// id 不存在跳过（并发删除场景），不回错。
pub fn reorder(conn: &Connection, ids: &[i64]) -> AppResult<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE plot_blocks SET sort_key = ?2 WHERE id = ?1",
            params![id, i as i64],
        )?;
    }
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM plot_blocks WHERE id = ?1", [id])?;
    Ok(())
}
