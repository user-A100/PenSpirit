use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::models::ProviderProfile;

/// settings 为 KV 表；provider 列表整体存一个 JSON key。
const PROVIDERS_KEY: &str = "providers";
const ACTIVE_PROVIDER_KEY: &str = "active_provider";

pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    match conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    }) {
        Ok(v) => Ok(Some(v)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// upsert：存在则覆盖。
pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )?;
    Ok(())
}

/// 解析 key="providers" 的 JSON 数组；未设置时为空列表。
pub fn providers(conn: &Connection) -> AppResult<Vec<ProviderProfile>> {
    match get(conn, PROVIDERS_KEY)? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| AppError::Db(format!("providers 数据损坏: {e}"))),
        None => Ok(Vec::new()),
    }
}

fn write_providers(conn: &Connection, list: &[ProviderProfile]) -> AppResult<()> {
    let json = serde_json::to_string(list)
        .map_err(|e| AppError::Db(format!("providers 序列化失败: {e}")))?;
    set(conn, PROVIDERS_KEY, &json)
}

/// id=0 即新增（分配 max(id)+1，从 JSON 里计算），否则更新原位。
pub fn save_provider(conn: &Connection, p: &ProviderProfile) -> AppResult<ProviderProfile> {
    let mut list = providers(conn)?;
    let saved;
    if p.id == 0 {
        let mut np = p.clone();
        np.id = list.iter().map(|x| x.id).max().unwrap_or(0) + 1;
        list.push(np.clone());
        saved = np;
    } else {
        match list.iter_mut().find(|x| x.id == p.id) {
            Some(slot) => *slot = p.clone(),
            None => return Err(AppError::NotFound(format!("服务商 #{} 不存在", p.id))),
        }
        saved = p.clone();
    }
    write_providers(conn, &list)?;
    Ok(saved)
}

/// 删除某个 KV 键（不存在则无操作）
pub fn remove(conn: &Connection, key: &str) -> AppResult<()> {
    conn.execute("DELETE FROM settings WHERE key = ?1", [key])?;
    Ok(())
}

/// 阶段 2B：挂在书 / 卷 / 章 id 上的 AI 键前缀（本书记忆、卷记忆、本章作者注、AI 写入着色片段）
pub const MEMORY_BOOK: &str = "memory:book:";
pub const MEMORY_VOLUME: &str = "memory:volume:";
pub const AUTHOR_NOTE: &str = "authornote:chapter:";
pub const AI_TINT: &str = "ai_tint:";
/// 阶段 2C：上下文包（每书）
pub const CTX_PRESETS: &str = "ctx_presets:";

/// 章（或卷）被彻底删除：清掉挂在它 id 上的 AI 键，不留孤儿
pub fn purge_chapter_keys(conn: &Connection, chapter_id: i64) -> AppResult<()> {
    for prefix in [MEMORY_VOLUME, AUTHOR_NOTE, AI_TINT] {
        remove(conn, &format!("{prefix}{chapter_id}"))?;
    }
    Ok(())
}

/// 书被彻底删除：本书记忆 + 书内全部章 / 卷的 AI 键（须在删章行之前调用）
pub fn purge_book_keys(conn: &Connection, book_id: i64) -> AppResult<()> {
    remove(conn, &format!("{MEMORY_BOOK}{book_id}"))?;
    remove(conn, &format!("{CTX_PRESETS}{book_id}"))?;
    let ids: Vec<i64> = conn
        .prepare("SELECT id FROM chapters WHERE book_id = ?1")?
        .query_map([book_id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    for id in ids {
        purge_chapter_keys(conn, id)?;
    }
    Ok(())
}

pub fn delete_provider(conn: &Connection, id: i64) -> AppResult<()> {
    let mut list = providers(conn)?;
    list.retain(|x| x.id != id);
    write_providers(conn, &list)?;
    // 删的是「使用中」的服务商：一并清掉激活位。否则留下悬空 id——
    // 服务商 id 取「现有最大 + 1」，删光后新建的那个会复用这个 id，被悄悄当成「使用中」。
    if active_provider_id(conn)? == Some(id) {
        remove(conn, ACTIVE_PROVIDER_KEY)?;
    }
    Ok(())
}

fn get_i64(conn: &Connection, key: &str) -> AppResult<Option<i64>> {
    match get(conn, key)? {
        Some(v) => v
            .parse::<i64>()
            .map(Some)
            .map_err(|_| AppError::Db(format!("settings 键 {key} 的值不是整数: {v}"))),
        None => Ok(None),
    }
}

/// key="active_provider"。
pub fn active_provider_id(conn: &Connection) -> AppResult<Option<i64>> {
    get_i64(conn, ACTIVE_PROVIDER_KEY)
}

pub fn set_active_provider(conn: &Connection, id: i64) -> AppResult<()> {
    set(conn, ACTIVE_PROVIDER_KEY, &id.to_string())
}

/// key="style:book:{id}"，每书一个激活文风位。
pub fn active_style_id(conn: &Connection, book_id: i64) -> AppResult<Option<i64>> {
    get_i64(conn, &format!("style:book:{book_id}"))
}

pub fn set_active_style(conn: &Connection, book_id: i64, style_id: i64) -> AppResult<()> {
    set(conn, &format!("style:book:{book_id}"), &style_id.to_string())
}
