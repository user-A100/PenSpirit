use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::Connection;

use crate::db;
use crate::error::AppError;
use crate::fs_service;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub root: PathBuf,
}

impl AppState {
    /// 建目录、开库、迁移、library/。注：db::init 需 &mut Connection
    /// （rusqlite_migration 2.6 的 to_latest 签名），故先迁移再包进 Mutex。
    pub fn init(app_data: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(app_data)?;
        let mut conn = Connection::open(app_data.join("bixian.db"))?;
        db::init(&mut conn).map_err(|e| AppError::Db(e.to_string()))?;
        let root = fs_service::library_root(app_data);
        fs::create_dir_all(&root)?;
        Ok(Self { db: Mutex::new(conn), root })
    }

    /// 测试用：目录内独立 db 文件，不与开发者本机数据混用
    pub fn test_state(app_data: &Path) -> Self {
        Self::init(app_data).expect("测试状态初始化失败")
    }
}
