//! M2-T11 敏感词检测：aho-corasick 多模式扫描 + 词库存取（settings key）。
//!
//! 用 `find_overlapping_iter`——「蝴蝶」与「蝶花」这类互相重叠的词都要报出来，
//! 不能因为前一个匹配吃掉字符就漏掉后一个。
//! 检查是纯手动的：只报告，不改 md。

use std::collections::HashSet;
use std::path::Path;

use aho_corasick::AhoCorasick;
use serde::Serialize;

use crate::commands::lock;
use crate::error::AppResult;
use crate::porting::import::detect_and_decode;
use crate::repo;
use crate::state::AppState;

/// 词库在 settings 表里的键
pub const WORDS_KEY: &str = "sensitive:words";
/// 命中处前后各取的字符数
pub const CONTEXT_CHARS: usize = 20;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Hit {
    pub word: String,
    /// 命中处在正文中的**字节**偏移（前端展示用 context 即可，此值供定位扩展）
    pub byte_start: usize,
    /// 命中处前后各 `CONTEXT_CHARS` 个字符（按字符切，不会截断多字节字符）
    pub context: String,
}

fn context_around(content: &str, start: usize, end: usize) -> String {
    let before: String = {
        let mut v: Vec<char> = content[..start].chars().rev().take(CONTEXT_CHARS).collect();
        v.reverse();
        v.into_iter().collect()
    };
    let after: String = content[end..].chars().take(CONTEXT_CHARS).collect();
    format!("{before}{}{after}", &content[start..end])
}

/// 扫描正文，返回全部命中（含互相重叠的）
pub fn scan(content: &str, words: &[String]) -> Vec<Hit> {
    let patterns: Vec<&str> = words.iter().map(|w| w.trim()).filter(|w| !w.is_empty()).collect();
    if patterns.is_empty() {
        return Vec::new();
    }
    let ac = match AhoCorasick::new(&patterns) {
        Ok(ac) => ac,
        Err(_) => return Vec::new(),
    };
    ac.find_overlapping_iter(content)
        .map(|m| Hit {
            word: content[m.start()..m.end()].to_string(),
            byte_start: m.start(),
            context: context_around(content, m.start(), m.end()),
        })
        .collect()
}

/// 解析词库文本：一行一词，去空行、去 `#` 注释、去重（保留首次出现顺序）
pub fn parse_word_lines(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    text.lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter(|l| seen.insert(l.to_string()))
        .map(|l| l.to_string())
        .collect()
}

// ---- 词库存取（settings key="sensitive:words"，JSON 数组） ----

pub fn get_words_inner(s: &AppState) -> AppResult<Vec<String>> {
    match repo::settings::get(&*lock(s)?, WORDS_KEY)? {
        Some(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        None => Ok(Vec::new()),
    }
}

pub fn set_words_inner(s: &AppState, words: &[String]) -> AppResult<Vec<String>> {
    let cleaned = parse_word_lines(&words.join("\n"));
    let json = serde_json::to_string(&cleaned).unwrap_or_else(|_| "[]".into());
    repo::settings::set(&*lock(s)?, WORDS_KEY, &json)?;
    Ok(cleaned)
}

/// 用已存词库扫描正文
pub fn scan_inner(s: &AppState, content: &str) -> AppResult<Vec<Hit>> {
    let words = get_words_inner(s)?;
    Ok(scan(content, &words))
}

/// 从 txt 文件导入词库（只解析返回，保存由前端确认后再落库）
pub fn import_words_inner(path: &Path) -> AppResult<Vec<String>> {
    let bytes = std::fs::read(path)?;
    Ok(parse_word_lines(&detect_and_decode(&bytes)))
}
