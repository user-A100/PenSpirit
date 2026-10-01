use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

/// 建表迁移 + 开启外键级联（SQLite 默认关闭，须每次连接显式开启）。
/// 返回 Box<dyn Error> 以同时容纳迁移错误与 pragma 错误，调用方可直接展示。
/// 注：rusqlite_migration 2.6 的 to_latest 需 &mut Connection（与计划所据旧版 API 不同）。
pub fn init(conn: &mut Connection) -> Result<(), Box<dyn std::error::Error>> {
    migrations().to_latest(conn)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(())
}

/// 全部迁移（按序）。测试可用 `to_version` 造出旧版本库，验证升级无损。
pub fn migrations() -> Migrations<'static> {
    Migrations::new(vec![
        M::up(include_str!("../migrations/0001_init.sql")),
        M::up(include_str!("../migrations/0002_m1.sql")),
        M::up(include_str!("../migrations/0003_m2.sql")),
        M::up(include_str!("../migrations/0004_m2_trash.sql")),
        M::up(include_str!("../migrations/0005_m2_bump.sql")),
        M::up(include_str!("../migrations/0006_m2_stats.sql")),
        M::up(include_str!("../migrations/0007_m3.sql")),
        M::up(include_str!("../migrations/0008_m4_characters.sql")),
        M::up(include_str!("../migrations/0009_m4_outlines.sql")),
        M::up(include_str!("../migrations/0010_m4_materials_plot.sql")),
        M::up(include_str!("../migrations/0011_m4_import_dedup.sql")),
        M::up(include_str!("../migrations/0012_m4_foreshadow_repay.sql")),
        M::up(include_str!("../migrations/0013_m5_graph.sql")),
        M::up(include_str!("../migrations/0014_m7_meta.sql")),
        M::up(include_str!("../migrations/0015_m7_templates.sql")),
        M::up(include_str!("../migrations/0016_m7_collections.sql")),
        M::up(include_str!("../migrations/0017_m7_batch7.sql")),
        M::up(include_str!("../migrations/0018_ordered_collections.sql")),
        M::up(include_str!("../migrations/0019_chat_v2.sql")),
        M::up(include_str!("../migrations/0020_volumes.sql")),
        M::up(include_str!("../migrations/0021_ai_context.sql")),
        M::up(include_str!("../migrations/0022_sessions_v3.sql")),
        M::up(include_str!("../migrations/0023_chat_rating.sql")),
    ])
}
