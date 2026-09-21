//! M7 批次1：章节元数据定义与关键词（labels/statuses/keywords/chapter_keywords）。

use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Keyword, Label, LabelInput, Status, StatusInput};

/// 关键词建词时的轮换色板（Tailwind 400 系，深底可读）
const KEYWORD_PALETTE: [&str; 8] = [
    "#60a5fa", "#4ade80", "#facc15", "#fb923c", "#f87171", "#c084fc", "#2dd4bf", "#f472b6",
];

/// 新书种子：六状态 + 六色标签（迁移 0014 为既有书补种同款）。
pub(crate) fn seed_defaults(conn: &Connection, book_id: i64) -> AppResult<()> {
    for (i, title) in ["待写", "写作中", "初稿", "修改稿", "定稿", "已完成"].iter().enumerate() {
        conn.execute(
            "INSERT INTO statuses (book_id, title, sort_key) VALUES (?1, ?2, ?3)",
            params![book_id, title, i as i64],
        )?;
    }
    for (i, (title, color)) in [
        ("红", "#f87171"),
        ("橙", "#fb923c"),
        ("黄", "#facc15"),
        ("绿", "#4ade80"),
        ("蓝", "#60a5fa"),
        ("紫", "#c084fc"),
    ]
    .iter()
    .enumerate()
    {
        conn.execute(
            "INSERT INTO labels (book_id, title, color, sort_key) VALUES (?1, ?2, ?3, ?4)",
            params![book_id, title, color, i as i64],
        )?;
    }
    Ok(())
}

// ---- 标签 ----

const LABEL_COLS: &str = "id, book_id, title, color, sort_key, created_at";

fn label_from_row(row: &rusqlite::Row) -> rusqlite::Result<Label> {
    Ok(Label {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        color: row.get(3)?,
        sort_key: row.get(4)?,
        created_at: row.get(5)?,
    })
}

pub fn labels_list(conn: &Connection, book_id: i64) -> AppResult<Vec<Label>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {LABEL_COLS} FROM labels WHERE book_id = ?1 ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], label_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn label_upsert(conn: &Connection, input: &LabelInput) -> AppResult<Label> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("标签名不能为空".into()));
    }
    match input.id {
        None => {
            let sort_key: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_key), -1) + 1 FROM labels WHERE book_id = ?1",
                    [input.book_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            conn.execute(
                "INSERT INTO labels (book_id, title, color, sort_key) VALUES (?1, ?2, ?3, ?4)",
                params![input.book_id, title, input.color.trim(), sort_key],
            )?;
            get_label(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE labels SET title = ?1, color = ?2 WHERE id = ?3",
                params![title, input.color.trim(), id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("标签不存在".into()));
            }
            get_label(conn, id)
        }
    }
}

fn get_label(conn: &Connection, id: i64) -> AppResult<Label> {
    conn.query_row(
        &format!("SELECT {LABEL_COLS} FROM labels WHERE id = ?1"),
        [id],
        label_from_row,
    )
    .map_err(AppError::from)
}

/// 删除标签定义；章上的引用由 ON DELETE SET NULL 落空。
pub fn label_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM labels WHERE id = ?1", [id])?;
    Ok(())
}

// ---- 状态 ----

const STATUS_COLS: &str = "id, book_id, title, sort_key, created_at";

fn status_from_row(row: &rusqlite::Row) -> rusqlite::Result<Status> {
    Ok(Status {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        sort_key: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn statuses_list(conn: &Connection, book_id: i64) -> AppResult<Vec<Status>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {STATUS_COLS} FROM statuses WHERE book_id = ?1 ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], status_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn status_upsert(conn: &Connection, input: &StatusInput) -> AppResult<Status> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("状态名不能为空".into()));
    }
    match input.id {
        None => {
            let sort_key: i64 = conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_key), -1) + 1 FROM statuses WHERE book_id = ?1",
                    [input.book_id],
                    |r| r.get(0),
                )
                .map_err(AppError::from)?;
            conn.execute(
                "INSERT INTO statuses (book_id, title, sort_key) VALUES (?1, ?2, ?3)",
                params![input.book_id, title, sort_key],
            )?;
            get_status(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE statuses SET title = ?1 WHERE id = ?2",
                params![title, id],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("状态不存在".into()));
            }
            get_status(conn, id)
        }
    }
}

fn get_status(conn: &Connection, id: i64) -> AppResult<Status> {
    conn.query_row(
        &format!("SELECT {STATUS_COLS} FROM statuses WHERE id = ?1"),
        [id],
        status_from_row,
    )
    .map_err(AppError::from)
}

pub fn status_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM statuses WHERE id = ?1", [id])?;
    Ok(())
}

// ---- 关键词 ----

const KEYWORD_COLS: &str = "id, book_id, title, color, created_at";

fn keyword_from_row(row: &rusqlite::Row) -> rusqlite::Result<Keyword> {
    Ok(Keyword {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        color: row.get(3)?,
        created_at: row.get(4)?,
    })
}

pub fn keywords_list(conn: &Connection, book_id: i64) -> AppResult<Vec<Keyword>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {KEYWORD_COLS} FROM keywords WHERE book_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([book_id], keyword_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 建词：书内去重；color 省略时按色板轮换（取现有词数取模）。
pub fn keyword_create(conn: &Connection, book_id: i64, title: &str, color: Option<&str>) -> AppResult<Keyword> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("关键词不能为空".into()));
    }
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM keywords WHERE book_id = ?1 AND title = ?2)",
            params![book_id, title],
            |r| r.get(0),
        )
        .map_err(AppError::from)?;
    if exists {
        return Err(AppError::Invalid(format!("关键词「{title}」已存在")));
    }
    let color = match color.map(str::trim).filter(|c| !c.is_empty()) {
        Some(c) => c.to_string(),
        None => {
            let n: i64 = conn
                .query_row("SELECT COUNT(*) FROM keywords WHERE book_id = ?1", [book_id], |r| r.get(0))
                .map_err(AppError::from)?;
            KEYWORD_PALETTE[(n as usize) % KEYWORD_PALETTE.len()].to_string()
        }
    };
    conn.execute(
        "INSERT INTO keywords (book_id, title, color) VALUES (?1, ?2, ?3)",
        params![book_id, title, color],
    )?;
    conn.query_row(
        &format!("SELECT {KEYWORD_COLS} FROM keywords WHERE id = ?1"),
        [conn.last_insert_rowid()],
        keyword_from_row,
    )
    .map_err(AppError::from)
}

/// 删词：章上的引用由 chapter_keywords CASCADE 清掉。
pub fn keyword_delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM keywords WHERE id = ?1", [id])?;
    Ok(())
}

pub fn keywords_for_chapter(conn: &Connection, chapter_id: i64) -> AppResult<Vec<Keyword>> {
    let mut stmt = conn.prepare(
        "SELECT k.id, k.book_id, k.title, k.color, k.created_at FROM keywords k
         JOIN chapter_keywords ck ON ck.keyword_id = k.id
         WHERE ck.chapter_id = ?1 ORDER BY k.id",
    )?;
    let rows = stmt.query_map([chapter_id], keyword_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 章关键词整体替换（replace-all）；每个词必须与章同书，否则整批拒绝。
pub fn chapter_set_keywords(conn: &Connection, chapter_id: i64, keyword_ids: &[i64]) -> AppResult<Vec<Keyword>> {
    let book_id: i64 = conn
        .query_row("SELECT book_id FROM chapters WHERE id = ?1", [chapter_id], |r| r.get(0))
        .map_err(|_| AppError::NotFound("章节不存在".into()))?;
    for &kid in keyword_ids {
        let owner: Option<i64> = conn
            .query_row("SELECT book_id FROM keywords WHERE id = ?1", [kid], |r| r.get(0))
            .map(Some)
            .or_else(|e| match e {
                rusqlite::Error::QueryReturnedNoRows => Ok(None),
                e => Err(e),
            })
            .map_err(AppError::from)?;
        if owner != Some(book_id) {
            return Err(AppError::Invalid(format!("关键词 #{kid} 不属于本章所在书")));
        }
    }
    conn.execute("DELETE FROM chapter_keywords WHERE chapter_id = ?1", [chapter_id])?;
    for &kid in keyword_ids {
        conn.execute(
            "INSERT INTO chapter_keywords (chapter_id, keyword_id) VALUES (?1, ?2)",
            params![chapter_id, kid],
        )?;
    }
    keywords_for_chapter(conn, chapter_id)
}
