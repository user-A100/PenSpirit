//! M7 批次7 自定义元数据字段：书级定义 CRUD + 章节值读写（chapters.custom_meta JSON）。
//! 值以 def_id 十进制字符串为键；删定义留下孤儿键无碍（不做清洗）。
use rusqlite::{params, Connection};
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};
use crate::models::{CustomFieldDef, CustomFieldDefInput};

const COLS: &str = "id, book_id, name, field_type, list_options, sort_key, created_at";
const TYPES: [&str; 4] = ["text", "checkbox", "list", "date"];

fn from_row(r: &rusqlite::Row) -> rusqlite::Result<CustomFieldDef> {
    Ok(CustomFieldDef {
        id: r.get(0)?,
        book_id: r.get(1)?,
        name: r.get(2)?,
        field_type: r.get(3)?,
        list_options: r.get(4)?,
        sort_key: r.get(5)?,
        created_at: r.get(6)?,
    })
}

pub fn list_defs(conn: &Connection, book_id: i64) -> AppResult<Vec<CustomFieldDef>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM custom_field_defs WHERE book_id = ?1 ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get_def(conn: &Connection, id: i64) -> AppResult<CustomFieldDef> {
    conn.query_row(
        &format!("SELECT {COLS} FROM custom_field_defs WHERE id = ?1"),
        [id],
        from_row,
    )
    .map_err(|_| AppError::NotFound(format!("自定义字段 {id} 不存在")))
}

/// 校验 list_options：list 型必须是非空字符串数组；其余型一律归一为 '[]'。
fn validate_options(field_type: &str, raw: &str) -> AppResult<String> {
    if field_type != "list" {
        return Ok("[]".into());
    }
    let parsed: Vec<String> = serde_json::from_str(raw)
        .map_err(|_| AppError::Invalid("list 选项必须是字符串数组".into()))?;
    if parsed.is_empty() || parsed.iter().any(|s| s.trim().is_empty()) {
        return Err(AppError::Invalid("list 型至少要有一个非空选项".into()));
    }
    serde_json::to_string(&parsed).map_err(|e| AppError::Db(format!("选项序列化失败: {e}")))
}

/// id=None 插入，Some 更新（book_id 不改属主）。
pub fn upsert_def(conn: &Connection, input: &CustomFieldDefInput) -> AppResult<CustomFieldDef> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("字段名不能为空".into()));
    }
    if !TYPES.contains(&input.field_type.as_str()) {
        return Err(AppError::Invalid(format!("未知字段类型：{}", input.field_type)));
    }
    let options = validate_options(&input.field_type, &input.list_options)?;
    match input.id {
        None => {
            let dup: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM custom_field_defs WHERE book_id = ?1 AND name = ?2",
                    params![input.book_id, name],
                    |r| r.get(0),
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            if dup {
                return Err(AppError::Invalid(format!("字段「{name}」已存在")));
            }
            conn.execute(
                "INSERT INTO custom_field_defs (book_id, name, field_type, list_options, sort_key)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![input.book_id, name, input.field_type, options, input.sort_key],
            )?;
            get_def(conn, conn.last_insert_rowid())
        }
        Some(id) => {
            let old = get_def(conn, id)?;
            let dup: bool = conn
                .query_row(
                    "SELECT COUNT(*) FROM custom_field_defs WHERE book_id = ?1 AND name = ?2 AND id != ?3",
                    params![old.book_id, name, id],
                    |r| r.get(0),
                )
                .map_err(|e| AppError::Db(e.to_string()))?;
            if dup {
                return Err(AppError::Invalid(format!("字段「{name}」已存在")));
            }
            conn.execute(
                "UPDATE custom_field_defs SET name = ?1, field_type = ?2, list_options = ?3, sort_key = ?4 WHERE id = ?5",
                params![name, input.field_type, options, input.sort_key, id],
            )?;
            get_def(conn, id)
        }
    }
}

pub fn delete_def(conn: &Connection, id: i64) -> AppResult<()> {
    let n = conn
        .execute("DELETE FROM custom_field_defs WHERE id = ?1", [id])
        .map_err(|e| AppError::Db(e.to_string()))?;
    if n == 0 {
        return Err(AppError::NotFound(format!("自定义字段 {id} 不存在")));
    }
    Ok(())
}

fn load_map(conn: &Connection, chapter_id: i64) -> AppResult<Map<String, Value>> {
    let raw: String = conn
        .query_row("SELECT custom_meta FROM chapters WHERE id = ?1", [chapter_id], |r| r.get(0))
        .map_err(|_| AppError::NotFound(format!("章节 {chapter_id} 不存在")))?;
    if raw.is_empty() {
        return Ok(Map::new());
    }
    serde_json::from_str(&raw).map_err(|e| AppError::Db(format!("自定义字段数据损坏: {e}")))
}

fn save_map(conn: &Connection, chapter_id: i64, map: &Map<String, Value>) -> AppResult<()> {
    let json = serde_json::to_string(map).map_err(|e| AppError::Db(format!("自定义字段序列化失败: {e}")))?;
    conn.execute(
        "UPDATE chapters SET custom_meta = ?1 WHERE id = ?2",
        params![json, chapter_id],
    )
    .map_err(|e| AppError::Db(e.to_string()))?;
    Ok(())
}

/// 读一章的全部自定义字段值（键 = def_id 十进制字符串）。
pub fn get_values(conn: &Connection, chapter_id: i64) -> AppResult<Map<String, Value>> {
    load_map(conn, chapter_id)
}

/// 写一个字段值；None = 清除该键。按定义校验值形状与从属关系。
pub fn set_value(
    conn: &Connection,
    chapter_id: i64,
    def_id: i64,
    value: Option<Value>,
) -> AppResult<()> {
    let def = get_def(conn, def_id)?;
    let ch_book: i64 = conn
        .query_row("SELECT book_id FROM chapters WHERE id = ?1", [chapter_id], |r| r.get(0))
        .map_err(|_| AppError::NotFound(format!("章节 {chapter_id} 不存在")))?;
    if ch_book != def.book_id {
        return Err(AppError::Invalid("字段不属于章节所在书".into()));
    }
    if let Some(v) = &value {
        let ok = match def.field_type.as_str() {
            "checkbox" => v.is_boolean(),
            "text" | "date" => v.is_string(),
            "list" => {
                let options: Vec<String> = serde_json::from_str(&def.list_options).unwrap_or_default();
                v.is_string() && options.iter().any(|o| o == v)
            }
            _ => false,
        };
        if !ok {
            return Err(AppError::Invalid(format!(
                "字段「{}」的值类型不符（{} 型）",
                def.name, def.field_type
            )));
        }
    }
    let mut map = load_map(conn, chapter_id)?;
    match value {
        Some(v) => {
            map.insert(def_id.to_string(), v);
        }
        None => {
            map.remove(&def_id.to_string());
        }
    }
    save_map(conn, chapter_id, &map)
}
