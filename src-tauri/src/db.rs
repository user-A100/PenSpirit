use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// 建表迁移 + 开启外键级联（SQLite 默认关闭，须每次连接显式开启）。
/// 返回 Box<dyn Error> 以同时容纳迁移错误与 pragma 错误，调用方可直接展示。
/// 注：rusqlite_migration 2.6 的 to_latest 需 &mut Connection（与计划所据旧版 API 不同）。
pub fn init(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/0001_init.sql")),
        M::up(include_str!("../migrations/0002_m1.sql")),
        M::up(include_str!("../migrations/0003_m2.sql")),
        M::up(include_str!("../migrations/0004_m2_trash.sql")),
        M::up(include_str!("../migrations/0005_m2_bump.sql")),
    ])
    .to_latest(conn)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}
