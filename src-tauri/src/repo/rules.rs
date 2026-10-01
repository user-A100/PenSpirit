//! 写作规则（阶段 2B）：全书常驻 / 指定章卷 / 本轮手选。scope_ids 以 JSON 数组存。
use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{WritingRule, WritingRuleInput};

const COLS: &str = "id, book_id, title, content, mode, scope_ids, sort_key, created_at";

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<WritingRule> {
    let ids: String = row.get(5)?;
    Ok(WritingRule {
        id: row.get(0)?,
        book_id: row.get(1)?,
        title: row.get(2)?,
        content: row.get(3)?,
        mode: row.get(4)?,
        scope_ids: serde_json::from_str(&ids).unwrap_or_default(),
        sort_key: row.get(6)?,
        created_at: row.get(7)?,
    })
}

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<WritingRule>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM writing_rules WHERE book_id = ?1 ORDER BY sort_key, id"))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<WritingRule> {
    conn.query_row(&format!("SELECT {COLS} FROM writing_rules WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

pub fn upsert(conn: &Connection, input: &WritingRuleInput) -> AppResult<WritingRule> {
    let title = input.title.trim();
    if title.is_empty() {
        return Err(AppError::Invalid("规则标题不能为空".into()));
    }
    if !["always", "scoped", "manual"].contains(&input.mode.as_str()) {
        return Err(AppError::Invalid(format!("未知的规则作用方式：{}", input.mode)));
    }
    let ids = serde_json::to_string(&input.scope_ids).unwrap_or_else(|_| "[]".into());
    match input.id {
        None => {
            let next: i64 = conn.query_row(
                "SELECT COALESCE(MAX(sort_key), 0) + 1 FROM writing_rules WHERE book_id = ?1",
                [input.book_id],
                |r| r.get(0),
            )?;
            conn.execute(
                "INSERT INTO writing_rules (book_id, title, content, mode, scope_ids, sort_key) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![input.book_id, title, input.content.trim(), input.mode, ids, next],
            )?;
            get(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            conn.execute(
                "UPDATE writing_rules SET title = ?2, content = ?3, mode = ?4, scope_ids = ?5 WHERE id = ?1",
                params![id, title, input.content.trim(), input.mode, ids],
            )?;
            get(conn, id)
        }
    }
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM writing_rules WHERE id = ?1", [id])?;
    Ok(())
}

/// 设定卡「对 AI 隐藏」开关：kind = character / foreshadow / plot / outline
pub fn set_ai_hidden(conn: &Connection, kind: &str, id: i64, hidden: bool) -> AppResult<()> {
    let table = match kind {
        "character" => "characters",
        "foreshadow" => "foreshadows",
        "plot" => "plot_blocks",
        "outline" => "outlines",
        _ => return Err(AppError::Invalid(format!("不支持对 AI 隐藏的类型：{kind}"))),
    };
    let n = conn.execute(&format!("UPDATE {table} SET ai_hidden = ?2 WHERE id = ?1"), params![id, hidden as i64])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("{kind} #{id} 不存在")));
    }
    Ok(())
}

/// 人物「仅作者可见」笔记（永不注入）
pub fn set_secret_note(conn: &Connection, character_id: i64, note: &str) -> AppResult<()> {
    conn.execute("UPDATE characters SET secret_note = ?2 WHERE id = ?1", params![character_id, note])?;
    Ok(())
}
