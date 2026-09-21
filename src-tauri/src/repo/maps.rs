use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{Map, Place, PlaceInput};

const MAP_COLS: &str = "id, book_id, name, path, created_at, updated_at";
const PLACE_COLS: &str =
    "id, book_id, map_id, name, description, linked_character_ids, x, y, created_at, updated_at";

fn map_from_row(row: &rusqlite::Row) -> rusqlite::Result<Map> {
    Ok(Map {
        id: row.get(0)?,
        book_id: row.get(1)?,
        name: row.get(2)?,
        path: row.get(3)?,
        created_at: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

fn place_from_row(row: &rusqlite::Row) -> rusqlite::Result<Place> {
    Ok(Place {
        id: row.get(0)?,
        book_id: row.get(1)?,
        map_id: row.get(2)?,
        name: row.get(3)?,
        description: row.get(4)?,
        linked_character_ids: row.get(5)?,
        x: row.get(6)?,
        y: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

pub fn get_map(conn: &Connection, id: i64) -> AppResult<Map> {
    conn.query_row(
        &format!("SELECT {MAP_COLS} FROM maps WHERE id = ?1"),
        [id],
        map_from_row,
    )
    .map_err(AppError::from)
}

pub fn list_maps_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<Map>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {MAP_COLS} FROM maps WHERE book_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([book_id], map_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 文件已由命令层落盘后调用；name 去空白后非空。
pub fn insert_map(conn: &Connection, book_id: i64, name: &str, path: &str) -> AppResult<Map> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("地图名称不能为空".into()));
    }
    conn.execute(
        "INSERT INTO maps (book_id, name, path) VALUES (?1, ?2, ?3)",
        params![book_id, name, path],
    )?;
    get_map(conn, conn.last_insert_rowid())
}

/// 只改 DB 名称，图片文件不动。
pub fn rename_map(conn: &Connection, id: i64, name: &str) -> AppResult<Map> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("地图名称不能为空".into()));
    }
    let n = conn.execute(
        "UPDATE maps SET name = ?1, updated_at = datetime('now','localtime') WHERE id = ?2",
        params![name, id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound("地图不存在".into()));
    }
    get_map(conn, id)
}

/// 删行（级联删地点）；图片文件由调用方按返回路径清理。
pub fn delete_map(conn: &Connection, id: i64) -> AppResult<String> {
    let m = get_map(conn, id)?;
    conn.execute("DELETE FROM maps WHERE id = ?1", [id])?;
    Ok(m.path)
}

pub fn list_places_by_map(conn: &Connection, map_id: i64) -> AppResult<Vec<Place>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {PLACE_COLS} FROM places WHERE map_id = ?1 ORDER BY id"
    ))?;
    let rows = stmt.query_map([map_id], place_from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// pin 的新建/拖动/改名全走这里。校验：名称非空、0≤x,y≤100、map 存在；
/// book_id 取 map 行属主，杜绝跨书。
pub fn upsert_place(conn: &Connection, input: &PlaceInput) -> AppResult<Place> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::Invalid("地点名称不能为空".into()));
    }
    if !(0.0..=100.0).contains(&input.x) || !(0.0..=100.0).contains(&input.y) {
        return Err(AppError::Invalid("坐标须在 0~100 之间".into()));
    }
    let map = get_map(conn, input.map_id)?;
    match input.id {
        None => {
            conn.execute(
                "INSERT INTO places (book_id, map_id, name, description, linked_character_ids, x, y)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    map.book_id,
                    input.map_id,
                    name,
                    input.description.trim(),
                    input.linked_character_ids.trim(),
                    input.x,
                    input.y
                ],
            )?;
            let id = conn.last_insert_rowid();
            conn.query_row(
                &format!("SELECT {PLACE_COLS} FROM places WHERE id = ?1"),
                [id],
                place_from_row,
            )
            .map_err(AppError::from)
        }
        Some(id) => {
            let n = conn.execute(
                "UPDATE places SET map_id = ?1, name = ?2, description = ?3,
                 linked_character_ids = ?4, x = ?5, y = ?6,
                 updated_at = datetime('now','localtime') WHERE id = ?7",
                params![
                    input.map_id,
                    name,
                    input.description.trim(),
                    input.linked_character_ids.trim(),
                    input.x,
                    input.y,
                    id
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound("地点不存在".into()));
            }
            conn.query_row(
                &format!("SELECT {PLACE_COLS} FROM places WHERE id = ?1"),
                [id],
                place_from_row,
            )
            .map_err(AppError::from)
        }
    }
}

pub fn delete_place(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM places WHERE id = ?1", [id])?;
    Ok(())
}
