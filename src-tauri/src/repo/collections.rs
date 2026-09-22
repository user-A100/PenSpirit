use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Collection, CollectionInput};

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Collection> {
    Ok(Collection {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        kind: row.get(3)?,
        query: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

const COLS: &str = "id, book_id, name, kind, query, created_at, updated_at";

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<Collection>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM collections WHERE book_id = ?1 ORDER BY kind, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Collection> {
    conn.query_row(&format!("SELECT {COLS} FROM collections WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// id=None 插入，Some 更新（改名/改 query；book_id/kind 不改属主）。
/// 同书重名（含他人占用）→ Invalid；书内唯一由 UNIQUE(book_id, name) 兜底。
pub fn upsert(conn: &Connection, input: &CollectionInput) -> AppResult<Collection> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("集合名不能为空".into()));
    }
    if input.kind != "manual" && input.kind != "saved" {
        return Err(AppError::Invalid(format!("未知集合类型：{}", input.kind)));
    }
    let dup: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM collections WHERE book_id = ?1 AND name = ?2 AND id != ?3)",
        params![input.book_id, name, input.id.unwrap_or(-1)],
        |r| r.get(0),
    )?;
    if dup {
        return Err(AppError::Invalid(format!("集合「{name}」已存在")));
    }
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO collections (book_id, name, kind, query) VALUES (?1, ?2, ?3, ?4)",
                params![input.book_id, name, input.kind, input.query.trim()],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE collections SET name = ?2, query = ?3, updated_at = datetime('now','localtime') WHERE id = ?1",
                params![id, name, input.query.trim()],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("集合不存在".into()));
            }
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
    Ok(())
}

/// 集合成员（按书内目录序；软删章自动不在——join 条件过滤）。
/// saved 集合不走这里（结果实时算，见 commands::collection_chapters_inner）。
pub fn chapter_ids(conn: &Connection, collection_id: i64) -> AppResult<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT cc.chapter_id FROM collection_chapters cc
         JOIN chapters c ON c.id = cc.chapter_id AND c.deleted_at IS NULL
         WHERE cc.collection_id = ?1
         ORDER BY c.sort_key, c.id",
    )?;
    let rows = stmt.query_map([collection_id], |r| r.get(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 批量加入（同书校验；重复加入幂等 INSERT OR IGNORE）
pub fn add_chapters(conn: &Connection, collection: &Collection, chapter_ids: &[i64]) -> AppResult<()> {
    for &cid in chapter_ids {
        let ok: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM chapters WHERE id = ?1 AND book_id = ?2)",
            params![cid, collection.book_id],
            |r| r.get(0),
        )?;
        if !ok {
            return Err(AppError::Invalid(format!("章 #{cid} 不属于本集合所在书")));
        }
        conn.execute(
            "INSERT OR IGNORE INTO collection_chapters (collection_id, chapter_id) VALUES (?1, ?2)",
            params![collection.id, cid],
        )?;
    }
    conn.execute(
        "UPDATE collections SET updated_at = datetime('now','localtime') WHERE id = ?1",
        [collection.id],
    )?;
    Ok(())
}

pub fn remove_chapter(conn: &Connection, collection_id: i64, chapter_id: i64) -> AppResult<()> {
    conn.execute(
        "DELETE FROM collection_chapters WHERE collection_id = ?1 AND chapter_id = ?2",
        params![collection_id, chapter_id],
    )?;
    Ok(())
}
