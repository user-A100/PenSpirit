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

pub struct ScannedBook {
    pub slug: String,
    pub title: String,
    pub files: Vec<String>,
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
        if let Ok(rd) = fs::read_dir(dir.join("manuscript")) {
            for f in rd.flatten() {
                if f.path().extension().map(|e| e == "md").unwrap_or(false) {
                    let name = f.file_name().to_string_lossy().to_string();
                    files.push(format!("{slug}/manuscript/{name}"));
                }
            }
        }
        files.sort();
        out.push(ScannedBook { slug, title, files });
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}
