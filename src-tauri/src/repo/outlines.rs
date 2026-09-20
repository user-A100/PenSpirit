use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Outline, OutlineInput};

const COLS: &str = "id, book_id, kind, chapter_id, title, content, sort_key, created_at, updated_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Outline> {
    Ok(Outline {
        id: row.get(0)?,
        book_id: row.get(1)?,
        kind: row.get(2)?,
        chapter_id: row.get(3)?,
        title: row.get(4)?,
        content: row.get(5)?,
        sort_key: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn get(conn: &Connection, id: i64) -> AppResult<Outline> {
    conn.query_row(&format!("SELECT {COLS} FROM outlines WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

/// 某书的全部大纲条目：master → volume（按 sort_key）→ chapter（按章 id）
pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<Outline>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM outlines WHERE book_id = ?1
         ORDER BY CASE kind WHEN 'master' THEN 0 WHEN 'volume' THEN 1 ELSE 2 END,
                  sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 校验入参形态：kind 合法；chapter 细纲必须带 chapter_id，其余必须不带；
/// 卷纲卷名不得为空。
fn validate(input: &OutlineInput) -> AppResult<()> {
    match input.kind.as_str() {
        "master" => {
            if input.chapter_id.is_some() {
                return Err(AppError::Invalid("总纲不关联章节".into()));
            }
        }
        "volume" => {
            if input.chapter_id.is_some() {
                return Err(AppError::Invalid("卷纲不关联章节".into()));
            }
            if input.title.trim().is_empty() {
                return Err(AppError::Invalid("卷纲卷名不能为空".into()));
            }
        }
        "chapter" => {
            if input.chapter_id.is_none() {
                return Err(AppError::Invalid("章细纲必须关联章节".into()));
            }
        }
        other => return Err(AppError::Invalid(format!("非法的大纲类型: {other}"))),
    }
    Ok(())
}

/// id=None 插入；id=Some 更新（不存在回 NotFound）。
/// 唯一性：每书一篇总纲（master）、每章一篇细纲（chapter）——冲突时回 Invalid
/// 而非静默覆盖，让前端引导用户打开已有条目编辑。
pub fn upsert(conn: &Connection, input: &OutlineInput) -> AppResult<Outline> {
    validate(input)?;
    if input.kind == "master" && input.id.is_none() {
        let n: i64 = conn.query_row(
            "SELECT COUNT(*) FROM outlines WHERE book_id = ?1 AND kind = 'master'",
            [input.book_id],
            |r| r.get(0),
        )?;
        if n > 0 {
            return Err(AppError::Invalid("总纲已存在，请直接编辑".into()));
        }
    }
    if input.kind == "chapter" {
        let existing: Option<i64> = conn
            .query_row(
                "SELECT id FROM outlines WHERE chapter_id = ?1 AND kind = 'chapter'",
                [input.chapter_id],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                other => Err(other),
            })?;
        match (input.id, existing) {
            // 新建但该章已有细纲 → 引导编辑已有条目（返回其 id 语义用错误表达）
            (None, Some(_)) => return Err(AppError::Invalid("该章已有细纲，请直接编辑".into())),
            // 更新时 id 与既有不匹配（改了关联章）→ 拒绝，避免出现两篇
            (Some(id), Some(exist)) if exist != id => {
                return Err(AppError::Invalid("该章已有细纲，请直接编辑".into()));
            }
            _ => {}
        }
    }
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO outlines (book_id, kind, chapter_id, title, content, sort_key)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    input.book_id,
                    input.kind,
                    input.chapter_id,
                    input.title.trim(),
                    input.content,
                    input.sort_key
                ],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE outlines SET kind = ?2, chapter_id = ?3, title = ?4, content = ?5,
                 sort_key = ?6, updated_at = datetime('now','localtime') WHERE id = ?1",
                params![
                    id,
                    input.kind,
                    input.chapter_id,
                    input.title.trim(),
                    input.content,
                    input.sort_key
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("大纲条目不存在".into()));
            }
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM outlines WHERE id = ?1", [id])?;
    Ok(())
}
