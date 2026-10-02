use rusqlite::{params, Connection, Row};

use crate::error::AppResult;
use crate::models::PhraseBias;

// 词语偏置（阶段 2C）：ban = 避免使用（AI 腔），prefer = 可多用。book_id 为空 = 所有书通用。

const COLS: &str = "id, book_id, phrase, kind, created_at";

fn from_row(r: &Row) -> rusqlite::Result<PhraseBias> {
    Ok(PhraseBias { id: r.get(0)?, book_id: r.get(1)?, phrase: r.get(2)?, kind: r.get(3)?, created_at: r.get(4)? })
}

/// 本书适用的全部（通用 + 本书），通用在前
pub fn list(conn: &Connection, book_id: Option<i64>) -> AppResult<Vec<PhraseBias>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM phrase_bias WHERE book_id IS NULL OR book_id = ?1 ORDER BY book_id IS NOT NULL, kind, id"
    ))?;
    let rows = stmt.query_map([book_id.unwrap_or(-1)], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 新增（同范围同类已有则忽略）；返回是否真的加了
pub fn add(conn: &Connection, book_id: Option<i64>, phrase: &str, kind: &str) -> AppResult<bool> {
    let n = conn.execute(
        "INSERT OR IGNORE INTO phrase_bias (book_id, phrase, kind) VALUES (?1, ?2, ?3)",
        params![book_id, phrase.trim(), kind],
    )?;
    Ok(n > 0)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM phrase_bias WHERE id = ?1", [id])?;
    Ok(())
}

/// 常见 AI 腔（作者一键导入后可逐条删；不自动写入）
pub const DEFAULT_BANS: [&str; 20] = [
    "嘴角勾起一抹弧度",
    "嘴角微微上扬",
    "眼中闪过一丝",
    "眼底闪过一抹",
    "空气仿佛凝固",
    "时间仿佛静止",
    "一股暖流涌上心头",
    "心中五味杂陈",
    "眼神中带着一丝",
    "意味深长地笑了笑",
    "难以言喻的",
    "若有所思地",
    "深邃的眼眸",
    "不容置疑的语气",
    "宛如一幅画卷",
    "仿佛被抽空了力气",
    "一丝不易察觉的",
    "心中不由得一紧",
    "倒吸一口凉气",
    "脸上浮现出一抹",
];
