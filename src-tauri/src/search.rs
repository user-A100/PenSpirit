//! M2-T9 全书搜索：朴素全文扫描（单书 <10MB，毫秒级，不做 FTS）。
//!
//! 章节来源走 DB 的 `list_by_book`——它已过滤软删章，而软删章的 file_path 指向
//! `{book}/.trash/`，故 `.trash` 天然不会被搜到；`.history/` 不在 manuscript 下，同样不涉及。
//!
//! 匹配为大小写不敏感的字符子串；`whole_word` 要求匹配两侧不是词字符（字母数字或 CJK）。
//! 偏移量是**字符索引**（非字节）——前端 JS 侧按字符切分高亮，CJK 场景与 UTF-16 下标一致。

use serde::Serialize;

use crate::commands::lock;
use crate::error::AppResult;
use crate::fs_service;
use crate::repo;
use crate::state::AppState;
use crate::util::is_cjk;

/// 单次搜索的命中上限：查询词过于常见（如「的」）时防前端一次性渲染上万条
pub const MAX_HITS: usize = 500;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchHit {
    pub chapter_id: i64,
    pub chapter_title: String,
    /// 行号（从 1 起）
    pub line_no: i64,
    pub line_text: String,
    /// 命中区间（字符索引，左闭右开）
    pub match_start: i64,
    pub match_end: i64,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct SearchResult {
    pub hits: Vec<SearchHit>,
    /// 是否因触达 `MAX_HITS` 而截断（前端据此提示「结果过多」）
    pub truncated: bool,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || is_cjk(c)
}

/// 单字符大小写不敏感比较（逐字符比较，不改变索引——`str::to_lowercase` 会改变长度）
fn chars_match(a: char, b: char) -> bool {
    a == b || a.to_lowercase().eq(b.to_lowercase())
}

/// 一行内找出全部命中区间（字符索引）。命中后跳过整个匹配，故结果不重叠。
fn find_in_line(line: &[char], query: &[char], whole_word: bool) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let n = query.len();
    if n == 0 || n > line.len() {
        return out;
    }
    let mut i = 0;
    while i + n <= line.len() {
        if (0..n).all(|k| chars_match(line[i + k], query[k])) {
            let boundary_ok = !whole_word
                || (i == 0 || !is_word_char(line[i - 1]))
                    && (i + n == line.len() || !is_word_char(line[i + n]));
            if boundary_ok {
                out.push((i, i + n));
                i += n;
                continue;
            }
        }
        i += 1;
    }
    out
}

/// 在单章正文里搜索（纯函数，便于测试）
pub fn search_content(
    chapter_id: i64,
    title: &str,
    content: &str,
    query: &str,
    whole_word: bool,
) -> Vec<SearchHit> {
    let qchars: Vec<char> = query.chars().collect();
    if qchars.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    for (idx, line) in content.lines().enumerate() {
        let lchars: Vec<char> = line.chars().collect();
        for (start, end) in find_in_line(&lchars, &qchars, whole_word) {
            out.push(SearchHit {
                chapter_id,
                chapter_title: title.to_string(),
                line_no: (idx + 1) as i64,
                line_text: line.to_string(),
                match_start: start as i64,
                match_end: end as i64,
            });
        }
    }
    out
}

/// 搜当前书全部章节，按书内章节顺序、章内行序返回
pub fn search_book_inner(
    s: &AppState,
    book_id: i64,
    query: &str,
    whole_word: bool,
) -> AppResult<SearchResult> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(SearchResult::default());
    }
    let chapters = repo::chapters::list_by_book(&*lock(s)?, book_id)?;
    let mut result = SearchResult::default();
    for ch in chapters {
        let content = fs_service::read_chapter(&s.root, &ch.file_path)?;
        let hits = search_content(ch.id, &ch.title, &content, query, whole_word);
        for h in hits {
            if result.hits.len() >= MAX_HITS {
                result.truncated = true;
                return Ok(result);
            }
            result.hits.push(h);
        }
    }
    Ok(result)
}
