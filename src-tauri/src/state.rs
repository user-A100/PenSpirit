use std::collections::HashMap;
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
    /// 进行中流式任务的取消信号：session_id → 发送端。
    /// send 时登记，流自然结束或取消时移除。
    pub cancels: Mutex<HashMap<i64, tokio::sync::watch::Sender<bool>>>,
    /// ACP 待应答权限请求：chat session_id → 队列。
    /// 前端应答（或超时）后由 oneshot 通知后台应答任务回写 SDK responder。
    pub pending_perms: Mutex<HashMap<i64, Vec<crate::agents::interaction::PendingPerm>>>,
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
        Ok(Self {
            db: Mutex::new(conn),
            root,
            cancels: Mutex::new(HashMap::new()),
            pending_perms: Mutex::new(HashMap::new()),
        })
    }

    /// 测试用：目录内独立 db 文件，不与开发者本机数据混用
    pub fn test_state(app_data: &Path) -> Self {
        Self::init(app_data).expect("测试状态初始化失败")
    }

    /// 配置目录（%APPDATA%/com.bixian.app 本体）：agents.json 等
    /// 与 library 平级的配置文件存放处。root = app_data/library，
    /// 故取其父目录。
    pub fn config_dir(&self) -> PathBuf {
        self.root
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| self.root.clone())
    }
}
