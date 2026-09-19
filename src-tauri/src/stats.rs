//! M2-T11 写作统计：按（本地日期, 书）差量累加。
//!
//! 差量由前端从 TipTap transaction 里算好再传进来（见 ChapterEditor）：粘贴与 AI 采纳不计，
//! 单次跳变过大直接丢弃（切章/恢复快照这类程序化改动不该算进"今天写了多少"）。
//! 日期在 SQL 里取 `date('now','localtime')`——跨 0 点自然落到新行，前端无需关心。

use rusqlite::params;
use serde::Serialize;

use crate::commands::lock;
use crate::error::AppResult;
use crate::models::DailyStat;
use crate::state::AppState;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WritingStat {
    pub date: String,
    pub book_id: i64,
    pub words: i64,
    pub active_minutes: i64,
}

/// 累加当日字数（`delta_words` 可负）；`count_minute` 为真时活跃分钟 +1
/// （同一分钟只该传一次 true，由前端保证）。
pub fn add_inner(
    s: &AppState,
    book_id: i64,
    delta_words: i64,
    count_minute: bool,
) -> AppResult<()> {
    let conn = lock(s)?;
    conn.execute(
        "INSERT INTO writing_stats (date, book_id, words, active_minutes)
         VALUES (date('now','localtime'), ?1, ?2, ?3)
         ON CONFLICT(date, book_id) DO UPDATE SET
           words = words + excluded.words,
           active_minutes = active_minutes + excluded.active_minutes",
        params![book_id, delta_words, count_minute as i64],
    )?;
    Ok(())
}

/// 当日该书统计（无记录时返回全 0，日期仍为今天）
pub fn today_inner(s: &AppState, book_id: i64) -> AppResult<WritingStat> {
    let conn = lock(s)?;
    let row = conn.query_row(
        "SELECT date('now','localtime'), words, active_minutes
         FROM writing_stats WHERE date = date('now','localtime') AND book_id = ?1",
        params![book_id],
        |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)),
    );
    match row {
        Ok((date, words, active_minutes)) => Ok(WritingStat { date, book_id, words, active_minutes }),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(WritingStat {
            date: conn.query_row("SELECT date('now','localtime')", [], |r| r.get(0))?,
            book_id,
            words: 0,
            active_minutes: 0,
        }),
        Err(e) => Err(e.into()),
    }
}

/// 近 N 天按日聚合（M3）：book_id=None 跨书 SUM，Some 只统计该书。
/// days 窗口起点在 SQL 里用 printf('-%d days', ?1) 拼进 date('now','localtime',…)
/// 比较，ORDER BY date ASC 方便图表直接消费。
pub fn range_inner(s: &AppState, days: u32, book_id: Option<i64>) -> AppResult<Vec<DailyStat>> {
    let conn = lock(s)?;
    let sql = format!(
        "SELECT date, SUM(words), SUM(active_minutes) FROM writing_stats
         WHERE date >= date('now','localtime', printf('-%d days', ?1)){}
         GROUP BY date ORDER BY date ASC",
        match book_id {
            None => String::new(),
            Some(_) => " AND book_id = ?2".to_string(),
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = match book_id {
        None => stmt.query_map(params![days], from_stat_row)?,
        Some(bid) => stmt.query_map(params![days, bid], from_stat_row)?,
    };
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn from_stat_row(row: &rusqlite::Row) -> rusqlite::Result<DailyStat> {
    Ok(DailyStat {
        date: row.get(0)?,
        words: row.get(1)?,
        active_minutes: row.get(2)?,
    })
}
