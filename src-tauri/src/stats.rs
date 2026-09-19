//! M2-T11 写作统计：按（本地日期, 书）差量累加。
//!
//! 差量由前端从 TipTap transaction 里算好再传进来（见 ChapterEditor）：粘贴与 AI 采纳不计，
//! 单次跳变过大直接丢弃（切章/恢复快照这类程序化改动不该算进"今天写了多少"）。
//! 日期在 SQL 里取 `date('now','localtime')`——跨 0 点自然落到新行，前端无需关心。

use rusqlite::params;
use serde::Serialize;

use crate::commands::lock;
use crate::error::AppResult;
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
