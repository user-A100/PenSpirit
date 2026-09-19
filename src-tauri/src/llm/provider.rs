use rusqlite::Connection;

use crate::error::{AppError, AppResult};
use crate::models::ProviderProfile;
use crate::repo;

/// 解析当前激活的 AI 服务商档案：
/// active_provider_id → providers 列表中查找；
/// 无 active 或 active 指向不存在的档案 → `AppError::Invalid("未配置可用的 AI 服务商")`。
pub fn resolve(conn: &Connection) -> AppResult<ProviderProfile> {
    let Some(id) = repo::settings::active_provider_id(conn)? else {
        return Err(AppError::Invalid("未配置可用的 AI 服务商".into()));
    };
    repo::settings::providers(conn)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| AppError::Invalid("未配置可用的 AI 服务商".into()))
}
