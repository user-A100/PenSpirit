use rusqlite::{params, Connection};

use crate::error::{AppError, AppResult};
use crate::models::{ChapterMeta, ChapterMetaUpdate};

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterMeta> {
    Ok(ChapterMeta {
        id: row.get(0)?,
        book_id: row.get(1)?,
        file_path: row.get(2)?,
        title: row.get(3)?,
        sort_key: row.get(4)?,
        word_count: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        deleted_at: row.get(8)?,
        orig_file_path: row.get(9)?,
        synopsis: row.get(10)?,
        label_id: row.get(11)?,
        status_id: row.get(12)?,
        target_words: row.get(13)?,
    })
}

const COLS: &str = "id, book_id, file_path, title, sort_key, word_count, created_at, updated_at, deleted_at, orig_file_path, synopsis, label_id, status_id, target_words";

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapters WHERE book_id = ?1 AND deleted_at IS NULL ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 不含软删过滤的全量列表（书目录改名重写路径用）
pub fn list_all_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapters WHERE book_id = ?1 ORDER BY sort_key, id"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<ChapterMeta> {
    conn.query_row(&format!("SELECT {COLS} FROM chapters WHERE id = ?1"), [id], from_row)
        .map_err(AppError::from)
}

pub fn create(conn: &Connection, book_id: i64, file_path: &str, title: &str) -> AppResult<ChapterMeta> {
    let sort_key = conn.query_row(
        "SELECT COALESCE(MAX(sort_key), 0.0) + 1.0 FROM chapters WHERE book_id = ?1",
        [book_id],
        |r| r.get::<_, f64>(0),
    )?;
    conn.execute(
        "INSERT INTO chapters (book_id, file_path, title, sort_key) VALUES (?1, ?2, ?3, ?4)",
        params![book_id, file_path, title, sort_key],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, new_title: &str, new_file_path: &str) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET title = ?2, file_path = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, new_title, new_file_path],
    )?;
    get(conn, id)
}

pub fn touch_content(conn: &Connection, id: i64, word_count: i64) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET word_count = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![id, word_count],
    )?;
    get(conn, id)
}

/// 批量重排（拖拽后落 sort_key）：传入有序 id 列表，按位写 sort_key。
/// 不触碰 updated_at（排序不是内容变更）。
pub fn reorder(conn: &Connection, ids: &[i64]) -> AppResult<()> {
    for (i, id) in ids.iter().enumerate() {
        conn.execute(
            "UPDATE chapters SET sort_key = ?2 WHERE id = ?1",
            params![id, i as f64],
        )?;
    }
    Ok(())
}

/// 元数据部分更新：只写出现的字段；不触碰 updated_at（那是正文时间戳）。
/// label/status 引用必须与章同书（Some(id) 时校验），防止跨书挂错定义。
pub fn update_meta(conn: &Connection, id: i64, u: &ChapterMetaUpdate) -> AppResult<ChapterMeta> {
    let ch = get(conn, id)?;
    if let Some(syn) = &u.synopsis {
        conn.execute(
            "UPDATE chapters SET synopsis = ?2 WHERE id = ?1",
            params![id, syn.trim()],
        )?;
    }
    if let Some(l) = u.label_id {
        match l {
            None => conn.execute("UPDATE chapters SET label_id = NULL WHERE id = ?1", [id])?,
            Some(lid) => {
                let ok: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM labels WHERE id = ?1 AND book_id = ?2)",
                    params![lid, ch.book_id],
                    |r| r.get(0),
                )?;
                if !ok {
                    return Err(AppError::Invalid(format!("标签 #{lid} 不属于本章所在书")));
                }
                conn.execute("UPDATE chapters SET label_id = ?2 WHERE id = ?1", params![id, lid])?
            }
        };
    }
    if let Some(st) = u.status_id {
        match st {
            None => conn.execute("UPDATE chapters SET status_id = NULL WHERE id = ?1", [id])?,
            Some(sid) => {
                let ok: bool = conn.query_row(
                    "SELECT EXISTS(SELECT 1 FROM statuses WHERE id = ?1 AND book_id = ?2)",
                    params![sid, ch.book_id],
                    |r| r.get(0),
                )?;
                if !ok {
                    return Err(AppError::Invalid(format!("状态 #{sid} 不属于本章所在书")));
                }
                conn.execute("UPDATE chapters SET status_id = ?2 WHERE id = ?1", params![id, sid])?
            }
        };
    }
    if let Some(tw) = u.target_words {
        conn.execute(
            "UPDATE chapters SET target_words = ?2 WHERE id = ?1",
            params![id, tw],
        )?;
    }
    get(conn, id)
}

/// 同书未删章的 content_hash（NULL 不含；M4-T4 导入查重用）
pub fn hashes_for_book(conn: &Connection, book_id: i64) -> AppResult<Vec<String>> {
    let mut stmt =
        conn.prepare("SELECT content_hash FROM chapters WHERE book_id = ?1 AND deleted_at IS NULL AND content_hash IS NOT NULL")?;
    let rows = stmt.query_map([book_id], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn set_hash(conn: &Connection, id: i64, hash: &str) -> AppResult<()> {
    conn.execute("UPDATE chapters SET content_hash = ?1 WHERE id = ?2", params![hash, id])?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM chapters WHERE id = ?1", [id])?;
    Ok(())
}

// ---- M2-T6 回收站 ----

/// 回收站中的章（删除时间倒序；同秒按 id 倒序）
pub fn list_deleted_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapters WHERE book_id = ?1 AND deleted_at IS NOT NULL ORDER BY deleted_at DESC, id DESC"
    ))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 软删：文件已移至 trash_path（如 "shu/.trash/0001-yi.md"），记录原路径
pub fn soft_delete(conn: &Connection, id: i64, trash_path: &str, orig_path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chapters SET file_path = ?2, orig_file_path = ?3, deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?1",
        params![id, trash_path, orig_path],
    )?;
    Ok(())
}

/// 恢复：文件已移回 orig_path，清软删标记
pub fn restore(conn: &Connection, id: i64, orig_path: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chapters SET file_path = ?2, orig_file_path = NULL, deleted_at = NULL, updated_at = datetime('now') WHERE id = ?1",
        params![id, orig_path],
    )?;
    Ok(())
}

/// 书目录改名（old_slug → new_slug）后重写该书所有章节 file_path 前缀（含软删章的 .trash 路径）
pub fn rebase_book_prefix(conn: &Connection, book_id: i64, old_slug: &str, new_slug: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chapters SET file_path = ?3 || substr(file_path, ?4)
         WHERE book_id = ?1 AND file_path LIKE ?2",
        params![
            book_id,
            format!("{old_slug}/%"), // 前缀匹配；slug 不含 % 与 _，无转义问题
            format!("{new_slug}/"),
            (old_slug.chars().count() + 2) as i64, // substr 按字符计（非字节）：跳过 "old_slug/" 共 n+1 字符，从 n+2 起取
        ],
    )?;
    Ok(())
}

/// 下一个文件名序号：max(现存文件名序号前缀, AUTOINCREMENT 水位) + 1；无记录时 1。只增不减。
/// 前缀扫描防止与现存文件重名；sqlite_sequence 水位在行删除后不回退，
/// 保证「只增不减，避免重名」（该表在首次 AUTOINCREMENT 插入后才存在，缺失视为 0）。
/// 软删章的 .trash 路径同样参与扫描（其 file_path 仍带原序号前缀）。
pub fn next_index(conn: &Connection, book_id: i64) -> AppResult<i64> {
    let paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT file_path FROM chapters WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let prefix_max = paths
        .iter()
        .filter_map(|p| {
            p.rsplit('/')
                .next()?
                .split('-')
                .next()?
                .parse::<i64>()
                .ok()
        })
        .max()
        .unwrap_or(0);
    let seq: i64 = conn
        .query_row(
            "SELECT seq FROM sqlite_sequence WHERE name = 'chapters'",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    Ok(prefix_max.max(seq) + 1)
}

// ---- M7 批次7：自由卡片墙摆位（freeform_x/y 与 sort_key 解耦） ----

/// 全书摆位（未摆过的章 x=y=0，前端可跳过）。
pub fn freeform_positions(conn: &Connection, book_id: i64) -> AppResult<Vec<(i64, f64, f64)>> {
    let mut stmt = conn.prepare(
        "SELECT id, freeform_x, freeform_y FROM chapters
         WHERE book_id = ?1 AND deleted_at IS NULL ORDER BY id",
    )?;
    let rows = stmt.query_map([book_id], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, f64>(1)?, r.get::<_, f64>(2)?))
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn set_freeform_position(conn: &Connection, chapter_id: i64, x: f64, y: f64) -> AppResult<()> {
    let n = conn
        .execute(
            "UPDATE chapters SET freeform_x = ?1, freeform_y = ?2 WHERE id = ?3",
            params![x, y, chapter_id],
        )
        .map_err(|e| AppError::Db(e.to_string()))?;
    if n == 0 {
        return Err(AppError::NotFound(format!("章节 {chapter_id} 不存在")));
    }
    Ok(())
}
