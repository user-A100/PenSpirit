use std::fs;
use std::path::{Path, PathBuf};
use crate::error::{AppError, AppResult};
use crate::util::is_cjk;

pub fn library_root(app_data: &Path) -> PathBuf {
    app_data.join("library")
}

pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = true; // 折叠连续分隔符并去头部
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || is_cjk(ch) {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let s = out.trim_end_matches('-').to_string();
    if s.is_empty() { "untitled".into() } else { s }
}

pub fn unique_slug(root: &Path, base: &str) -> String {
    if !root.join(base).exists() { return base.to_string(); }
    for n in 2.. {
        let cand = format!("{base}-{n}");
        if !root.join(&cand).exists() { return cand; }
    }
    unreachable!()
}

pub fn create_book_dir(root: &Path, slug: &str, title: &str) -> AppResult<()> {
    let dir = root.join(slug);
    fs::create_dir_all(dir.join("manuscript"))?;
    fs::write(dir.join("book.json"), serde_json::json!({ "title": title }).to_string())?;
    Ok(())
}

pub fn chapter_rel_path(slug: &str, index: i64, title: &str) -> String {
    format!("{slug}/manuscript/{:04}-{}.md", index, slugify(title))
}

fn abs(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let p = root.join(rel);
    if !p.starts_with(root) {
        return Err(AppError::Invalid("路径越界".into()));
    }
    Ok(p)
}

pub fn write_chapter(root: &Path, rel: &str, content: &str) -> AppResult<()> {
    let p = abs(root, rel)?;
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(p, content)?;
    Ok(())
}

pub fn read_chapter(root: &Path, rel: &str) -> AppResult<String> {
    Ok(fs::read_to_string(abs(root, rel)?)?)
}

pub fn delete_rel(root: &Path, rel: &str) -> AppResult<()> {
    let p = abs(root, rel)?;
    if p.is_dir() {
        fs::remove_dir_all(p)?;
    } else {
        fs::remove_file(p)?;
    }
    Ok(())
}

/// 卷首语文件名（卷目录内；rescan 不把它当章）
pub const VOLUME_BODY: &str = "_index.md";

/// 扫描到的树节点（全书先序）：正文章 md 或卷目录；parent = 所属卷目录的相对路径
pub struct ScannedNode {
    pub rel: String,
    pub folder: bool,
    pub parent: Option<String>,
}

pub struct ScannedBook {
    pub slug: String,
    pub title: String,
    /// 全部正文章 md（含卷内），全书先序
    pub files: Vec<String>,
    /// 整棵树（卷 + 章），全书先序
    pub nodes: Vec<ScannedNode>,
}

/// 目录内的条目（按名排序）：(名, 是否目录)；只收子目录与 .md，跳过隐藏项与卷首语
fn list_entries(dir: &Path) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || name == VOLUME_BODY {
                continue;
            }
            let p = e.path();
            if p.is_dir() {
                out.push((name, true));
            } else if p.extension().map(|x| x == "md").unwrap_or(false) {
                out.push((name, false));
            }
        }
    }
    out.sort();
    out
}

pub fn scan_library(root: &Path) -> AppResult<Vec<ScannedBook>> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(root) {
        Ok(e) => e,
        Err(_) => return Ok(out),
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let slug = entry.file_name().to_string_lossy().to_string();
        // 隐藏目录一律排除：.trash_books（书级回收站）等库内工作目录不参与扫描
        if slug.starts_with('.') { continue; }
        let title = fs::read_to_string(dir.join("book.json"))
            .ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v["title"].as_str().map(String::from))
            .unwrap_or_else(|| slug.clone());
        let mut files = Vec::new();
        let mut nodes = Vec::new();
        // manuscript/ 顶层：md = 章，子目录 = 卷（只读一层）；隐藏项（.renumber-tmp 等）与卷首语跳过
        let ms = dir.join("manuscript");
        for (name, is_dir) in list_entries(&ms) {
            let rel = format!("{slug}/manuscript/{name}");
            if is_dir {
                nodes.push(ScannedNode { rel: rel.clone(), folder: true, parent: None });
                for (child, child_is_dir) in list_entries(&ms.join(&name)) {
                    if child_is_dir {
                        continue;
                    }
                    let crel = format!("{rel}/{child}");
                    files.push(crel.clone());
                    nodes.push(ScannedNode { rel: crel, folder: false, parent: Some(rel.clone()) });
                }
            } else {
                files.push(rel.clone());
                nodes.push(ScannedNode { rel, folder: false, parent: None });
            }
        }
        out.push(ScannedBook { slug, title, files, nodes });
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}
