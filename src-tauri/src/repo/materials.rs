use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Material, MaterialInput};

const COLS: &str = "id, title, category, content, tags, created_at, updated_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Material> {
    Ok(Material {
        id: row.get(0)?,
        title: row.get(1)?,
        category: row.get(2)?,
        content: row.get(3)?,
        tags: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<Material> {
    conn.query_row(&format!("SELECT {COLS} FROM materials WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// 全部素材：按分类聚拢（分类空的排最后），同类按更新时间倒序（最近编辑在前）
pub fn list(conn: &Connection) -> AppResult<Vec<Material>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM materials
         ORDER BY (category = ''), category, updated_at DESC, id DESC"
    ))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// id=None 插入；id=Some 更新（不存在回 NotFound）。素材名必填。
pub fn upsert(conn: &Connection, input: &MaterialInput) -> AppResult<Material> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("素材名不能为空".into()));
    }
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO materials (title, category, content, tags) VALUES (?1, ?2, ?3, ?4)",
                params![title, input.category.trim(), input.content, input.tags.trim()],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE materials SET title = ?1, category = ?2, content = ?3, tags = ?4,
                 updated_at = datetime('now','localtime') WHERE id = ?5",
                params![title, input.category.trim(), input.content, input.tags.trim(), id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("素材不存在".into()));
            }
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM materials WHERE id = ?1", [id])?;
    Ok(())
}

/// 关键词过滤（标题/分类/内容/标签 LIKE），空词返回全表。列表页搜索框用。
pub fn search(conn: &Connection, q: &str) -> AppResult<Vec<Material>> {
    let q = q.trim();
    if q.is_empty() {
        return list(conn);
    }
    let like = format!("%{}%", q.replace('%', "\\%"));
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM materials
         WHERE title LIKE ?1 ESCAPE '\\' OR category LIKE ?1 ESCAPE '\\'
            OR content LIKE ?1 ESCAPE '\\' OR tags LIKE ?1 ESCAPE '\\'
         ORDER BY (category = ''), category, updated_at DESC, id DESC"
    ))?;
    let rows = stmt.query_map([&like], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
