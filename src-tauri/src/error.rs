#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(String),
    #[error("文件错误: {0}")]
    Io(String),
    #[error("未找到: {0}")]
    NotFound(String),
    #[error("非法参数: {0}")]
    Invalid(String),
    #[error("数据库锁中毒")]
    LockPoisoned,
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("记录不存在".into()),
            _ => AppError::Db(e.to_string()),
        }
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
