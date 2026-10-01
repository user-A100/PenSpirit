//! M2-T8 导出：txt / docx。
//!
//! 章序按书内既有 sort_key 顺序输出（不按勾选顺序）；空筛选 = 全书。
//! 阶段 3B 起有卷：每进入一个新卷先输出卷标题（及卷首语）；docx 中卷为 Heading1、章为 Heading2，
//! 无卷的书章题仍为 Heading1。Word 导航窗格可直接跳卷 / 跳章。

use std::path::Path;

use serde::Deserialize;

use crate::commands::lock;
use crate::error::{AppError, AppResult};
use crate::fs_service;
use std::collections::HashMap;

use crate::models::ChapterMeta;
use crate::repo;
use crate::state::AppState;

/// 段首缩进（全角空格 ×2）
const INDENT: &str = "　　";

/// 导出范围：勾选的章节 id；空 = 全书
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ExportRange {
    #[serde(default)]
    pub chapter_ids: Vec<i64>,
}

/// 待导出的章节：按书内顺序，过滤出勾选项
fn chapters_of(s: &AppState, book_id: i64, range: &ExportRange) -> AppResult<Vec<ChapterMeta>> {
    let all = repo::chapters::list_by_book(&*lock(s)?, book_id)?;
    if range.chapter_ids.is_empty() {
        return Ok(all);
    }
    Ok(all.into_iter().filter(|c| range.chapter_ids.contains(&c.id)).collect())
}

/// 书内的卷：id → (卷名, 卷首语)
fn volumes_of(s: &AppState, book_id: i64) -> AppResult<HashMap<i64, (String, String)>> {
    let nodes = repo::chapters::list_nodes(&*lock(s)?, book_id)?;
    let mut out = HashMap::new();
    for n in nodes.into_iter().filter(|n| n.kind == "folder") {
        let body = fs_service::read_chapter(&s.root, &format!("{}/{}", n.file_path, fs_service::VOLUME_BODY)).unwrap_or_default();
        out.insert(n.id, (n.title, body));
    }
    Ok(out)
}

/// 正文逐行输出（CRLF；indent 时非空段落前加全角双空格，空行原样保留）
fn push_body(out: &mut String, body: &str, indent: bool) {
    for line in body.replace("\r\n", "\n").replace('\r', "\n").lines() {
        if line.trim().is_empty() {
            out.push_str("\r\n");
        } else {
            if indent {
                out.push_str(INDENT);
            }
            out.push_str(line);
            out.push_str("\r\n");
        }
    }
}

/// 组装纯文本：（进入新卷时）卷名 + 卷首语，章题 + 空行 + 正文；行尾统一 CRLF（记事本兼容）。
/// `indent = true` 时正文每个非空段落前加全角双空格；空行原样保留。
pub fn build_txt(s: &AppState, book_id: i64, range: &ExportRange, indent: bool) -> AppResult<String> {
    let volumes = volumes_of(s, book_id)?;
    let mut out = String::new();
    let mut current_volume: Option<i64> = None;
    for (i, ch) in chapters_of(s, book_id, range)?.iter().enumerate() {
        if i > 0 {
            out.push_str("\r\n");
        }
        let vol = ch.parent_id.filter(|p| volumes.contains_key(p));
        if vol.is_some() && vol != current_volume {
            let (title, body) = &volumes[&vol.unwrap()];
            out.push_str(title);
            out.push_str("\r\n\r\n");
            if !body.trim().is_empty() {
                push_body(&mut out, body, indent);
                out.push_str("\r\n");
            }
        }
        current_volume = vol;
        out.push_str(&ch.title);
        out.push_str("\r\n\r\n");
        let body = fs_service::read_chapter(&s.root, &ch.file_path)?;
        push_body(&mut out, &body, indent);
    }
    Ok(out)
}

pub fn export_txt_inner(
    s: &AppState,
    book_id: i64,
    range: &ExportRange,
    indent: bool,
    dest: &Path,
) -> AppResult<()> {
    let text = build_txt(s, book_id, range, indent)?;
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    std::fs::write(dest, text)?;
    Ok(())
}

/// 导出 docx：章题走 Heading1（需显式登记样式，否则是悬空引用），
/// 正文一行一段（docx-rs 的 add_text 会吃掉 \n，多行必须拆段）。
pub fn export_docx_inner(
    s: &AppState,
    book_id: i64,
    range: &ExportRange,
    dest: &Path,
) -> AppResult<()> {
    let volumes = volumes_of(s, book_id)?;
    let mut docx = docx_rs::Docx::new()
        .add_style(docx_rs::Style::new("Heading1", docx_rs::StyleType::Paragraph).name("Heading 1"))
        .add_style(docx_rs::Style::new("Heading2", docx_rs::StyleType::Paragraph).name("Heading 2"));
    // 有卷时：卷 = Heading1、章 = Heading2；无卷的书章题仍为 Heading1
    let chapter_style = if volumes.is_empty() { "Heading1" } else { "Heading2" };
    let mut current_volume: Option<i64> = None;
    for ch in chapters_of(s, book_id, range)? {
        let vol = ch.parent_id.filter(|p| volumes.contains_key(p));
        if vol.is_some() && vol != current_volume {
            let (title, body) = &volumes[&vol.unwrap()];
            docx = docx.add_paragraph(docx_rs::Paragraph::new().style("Heading1").add_run(docx_rs::Run::new().add_text(title)));
            for line in body.replace("\r\n", "\n").lines().filter(|l| !l.trim().is_empty()) {
                docx = docx.add_paragraph(docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text(line)));
            }
        }
        current_volume = vol;
        docx = docx.add_paragraph(
            docx_rs::Paragraph::new()
                .style(chapter_style)
                .add_run(docx_rs::Run::new().add_text(&ch.title)),
        );
        let body = fs_service::read_chapter(&s.root, &ch.file_path)?;
        for line in body.replace("\r\n", "\n").replace('\r', "\n").lines() {
            if line.trim().is_empty() {
                continue;
            }
            docx = docx.add_paragraph(docx_rs::Paragraph::new().add_run(docx_rs::Run::new().add_text(line)));
        }
    }
    if let Some(p) = dest.parent() {
        std::fs::create_dir_all(p)?;
    }
    let file = std::fs::File::create(dest)?;
    docx.build().pack(file).map_err(|e| AppError::Io(e.to_string()))?;
    Ok(())
}
