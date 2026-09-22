//! M2-T9 全书搜索 + M7 批次4 升级：多词 AND、`-`排除、`"短语"`、标题/正文范围。
//!
//! 章节来源走 DB 的 `list_by_book`——它已过滤软删章，而软删章的 file_path 指向
//! `{book}/.trash/`，故 `.trash` 天然不会被搜到；`.history/` 不在 manuscript 下，同样不涉及。
//!
//! 匹配为大小写不敏感的字符子串；`whole_word` 要求匹配两侧不是词字符（字母数字或 CJK）。
//! 偏移量是**字符索引**（非字节）——前端 JS 侧按字符切分高亮，CJK 场景与 UTF-16 下标一致。
//!
//! 查询语法（M7 批次4）：空格分词 = AND（章内标题+正文都要命中才算）；
//! 引号包住 = 短语（与普通词对子串匹配同义，主要为容纳含空格的词组）；
//! `-词` / `-"短语"` = 排除：含该词的章整个剔除（对标题+正文做包含判断）。

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
    /// 行号（从 1 起；0 = 标题命中）
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

/// 解析后的查询：terms 全命中章才保留，excludes 任一命中章即剔除
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedQuery {
    pub terms: Vec<String>,
    pub excludes: Vec<String>,
}

/// 空格分词；引号容纳短语；`-` 前缀（含 `-"…"`）为排除词
pub fn parse_query(query: &str) -> ParsedQuery {
    let mut out = ParsedQuery::default();
    let chars: Vec<char> = query.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let mut exclude = false;
        if chars[i] == '-' {
            exclude = true;
            i += 1;
        }
        let mut token = String::new();
        if i < chars.len() && chars[i] == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                token.push(chars[i]);
                i += 1;
            }
            if i < chars.len() {
                i += 1; // 跳过收尾引号
            }
        } else {
            while i < chars.len() && !chars[i].is_whitespace() {
                token.push(chars[i]);
                i += 1;
            }
        }
        if token.chars().any(|c| !c.is_whitespace()) {
            if exclude {
                out.excludes.push(token);
            } else {
                out.terms.push(token);
            }
        }
    }
    out
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

/// 在单章里搜索（纯函数，便于测试）。scope: "all" | "title" | "content"。
/// 多词 AND：每个词都至少命中一次（标题或正文，随 scope）才返回该章的命中；
/// 标题命中 line_no = 0。
pub fn search_content(
    chapter_id: i64,
    title: &str,
    content: &str,
    query: &str,
    whole_word: bool,
    scope: &str,
) -> Vec<SearchHit> {
    let pq = parse_query(query);
    if pq.terms.is_empty() {
        return Vec::new();
    }
    // 排除：对标题+正文整体做大小写不敏感包含（与词边界无关，章级剔除）
    if !pq.excludes.is_empty() {
        let hay = format!("{title}\n{content}").to_lowercase();
        if pq
            .excludes
            .iter()
            .any(|e| hay.contains(&e.to_lowercase()))
        {
            return Vec::new();
        }
    }

    let mut hits = Vec::new();
    let mut matched = vec![false; pq.terms.len()];

    let mut scan = |line_no: i64, line_text: &str, lchars: &[char]| {
        for (ti, term) in pq.terms.iter().enumerate() {
            let qchars: Vec<char> = term.chars().collect();
            for (start, end) in find_in_line(lchars, &qchars, whole_word) {
                matched[ti] = true;
                hits.push(SearchHit {
                    chapter_id,
                    chapter_title: title.to_string(),
                    line_no,
                    line_text: line_text.to_string(),
                    match_start: start as i64,
                    match_end: end as i64,
                });
            }
        }
    };

    if scope != "content" {
        let tchars: Vec<char> = title.chars().collect();
        scan(0, title, &tchars);
    }
    if scope != "title" {
        for (idx, line) in content.lines().enumerate() {
            let lchars: Vec<char> = line.chars().collect();
            scan((idx + 1) as i64, line, &lchars);
        }
    }

    if matched.iter().all(|&m| m) {
        hits
    } else {
        Vec::new()
    }
}

/// 搜当前书全部章节，按书内章节顺序、章内行序返回。scope: "all"|"title"|"content"。
pub fn search_book_inner(
    s: &AppState,
    book_id: i64,
    query: &str,
    whole_word: bool,
    scope: &str,
) -> AppResult<SearchResult> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(SearchResult::default());
    }
    let scope = match scope {
        "title" | "content" => scope,
        _ => "all",
    };
    let chapters = repo::chapters::list_by_book(&*lock(s)?, book_id)?;
    let mut result = SearchResult::default();
    for ch in chapters {
        let content = if scope == "title" {
            String::new()
        } else {
            fs_service::read_chapter(&s.root, &ch.file_path)?
        };
        let hits = search_content(ch.id, &ch.title, &content, query, whole_word, scope);
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
