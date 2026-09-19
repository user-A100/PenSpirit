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

pub fn delete_provider(conn: &Connection, id: i64) -> AppResult<()> {
    let mut list = providers(conn)?;
    list.retain(|x| x.id != id);
    write_providers(conn, &list)
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
