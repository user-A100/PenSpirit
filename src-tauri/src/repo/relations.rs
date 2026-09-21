use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{CharacterRelation, CharacterRelationInput};

const COLS: &str =
    "id, book_id, source_id, target_id, relation_type, note, created_at, updated_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<CharacterRelation> {
    Ok(CharacterRelation {
        id: row.get(0)?,
        book_id: row.get(1)?,
        source_id: row.get(2)?,
        target_id: row.get(3)?,
        relation_type: row.get(4)?,
        note: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<CharacterRelation> {
    conn.query_row(
        &format!("SELECT {COLS} FROM character_relations WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(AppError::from)
}

/// 某书全部关系（按创建顺序）
pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<CharacterRelation>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM character_relations WHERE book_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 双方角色存在且同书；类型去空白后非空；source ≠ target。
fn validate(conn: &Connection, input: &CharacterRelationInput) -> AppResult<String> {
    let ty = input.relation_type.trim().to_string();
    if ty.is_empty() {
        return Err(AppError::Invalid("关系类型不能为空".into()));
    }
    if input.source_id == input.target_id {
        return Err(AppError::Invalid("不能与自己建立关系".into()));
    }
    let book_of = |id: i64| -> AppResult<i64> {
        conn.query_row("SELECT book_id FROM characters WHERE id = ?1", [id], |r| r.get(0))
            .map_err(|_| AppError::NotFound("人物卡不存在".into()))
    };
    if book_of(input.source_id)? != input.book_id || book_of(input.target_id)? != input.book_id {
        return Err(AppError::Invalid("关系双方必须属于同一本书".into()));
    }
    Ok(ty)
}

/// id=None 插入；同 (source,target,type) 已存在则静默转更新 note。
/// id=Some 更新 type/note，改型撞已有行时拒绝。
pub fn upsert(conn: &Connection, input: &CharacterRelationInput) -> AppResult<CharacterRelation> {
    let ty = validate(conn, input)?;
    let note = input.note.trim();
    match input.id {
        None => {
            let existing: Option<i64> = conn
                .query_row(
                    "SELECT id FROM character_relations
                     WHERE source_id = ?1 AND target_id = ?2 AND relation_type = ?3",
                    params![input.source_id, input.target_id, ty],
                    |r| r.get(0),
                )
                .ok();
            if let Some(id) = existing {
                conn.execute(
                    "UPDATE character_relations SET note = ?1, updated_at = datetime('now','localtime')
                     WHERE id = ?2",
                    params![note, id],
                )?;
                return get(conn, id);
            }
            conn.execute(
                "INSERT INTO character_relations (book_id, source_id, target_id, relation_type, note)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![input.book_id, input.source_id, input.target_id, ty, note],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let dup: Option<i64> = conn
                .query_row(
                    "SELECT id FROM character_relations
                     WHERE source_id = ?1 AND target_id = ?2 AND relation_type = ?3 AND id != ?4",
                    params![input.source_id, input.target_id, ty, id],
                    |r| r.get(0),
                )
                .ok();
            if dup.is_some() {
                return Err(AppError::Invalid("该关系已存在".into()));
            }
            let n = conn.execute(
                "UPDATE character_relations SET relation_type = ?1, note = ?2,
                 updated_at = datetime('now','localtime') WHERE id = ?3",
                params![ty, note, id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("关系不存在".into()));
            }
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM character_relations WHERE id = ?1", [id])?;
    Ok(())
}
