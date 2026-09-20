//! M2-T8 导入：编码检测 + 分章 + 批量落库。
//!
//! 分章规则还原自作家助手 importUtil 并做增强（见 `split_txt`）。
//! `detect_and_decode` 用 chardetng 猜编码、encoding_rs 解码（GBK/GB18030/UTF-8 等）。

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::commands::{self, lock};
use crate::error::{AppError, AppResult};
use crate::models::ChapterMeta;
use crate::repo;
use crate::state::AppState;
use crate::util::count_words;

/// 章题截断长度（字符）
pub const TITLE_MAX_CHARS: usize = 35;
/// 标题行长度上限（字符）：网文章题不会超过 40 字，超长的是正文（防长句误切）
const TITLE_LINE_MAX_CHARS: usize = 40;
/// 特殊标题行标记：命中即单独成章
const SPECIAL_MARKERS: [&str; 7] = ["序章", "楔子", "引子", "番外", "尾声", "终章", "后记"];
/// 句读标点：以它们结尾的行是正文，不可能是标题（防空把「第二天回家。」切成章）
const SENTENCE_END: [char; 7] = ['。', '！', '？', '，', '、', '；', '：'];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParsedChapter {
    pub title: String,
    pub content: String,
    /// 所属卷标题（仅用于导入预览分组——chapters 表无卷字段，不落库）
    #[serde(default)]
    pub volume: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImportReport {
    pub chapters: i64,
    pub words: i64,
}

/// 编码检测 + 解码：chardetng 猜（BOM 优先，空 tld 不做域名偏好），encoding_rs 解。
/// 猜错时不 panic——encoding_rs 用替换字符兜底，最坏结果是乱码而非崩溃。
pub fn detect_and_decode(bytes: &[u8]) -> String {
    let mut detector = chardetng::EncodingDetector::new(chardetng::Iso2022JpDetection::Deny);
    detector.feed(bytes, true);
    let encoding = detector.guess(None, chardetng::Utf8Detection::Allow);
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

fn is_cn_numeral(c: char) -> bool {
    matches!(
        c,
        '〇' | '零' | '一' | '二' | '两' | '三' | '四' | '五' | '六' | '七' | '八' | '九' | '十' | '百' | '千' | '万'
    )
}

/// 全角数字 ０-９（网文 txt 常见）
fn is_digit(c: char) -> bool {
    c.is_ascii_digit() || ('０'..='９').contains(&c)
}

/// 章卷编号字符集：中文数字 + ASCII/全角数字
fn is_numeral(c: char) -> bool {
    is_cn_numeral(c) || is_digit(c)
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        s.chars().take(max).collect()
    }
}

fn ends_with_sentence(c: char) -> bool {
    SENTENCE_END.contains(&c)
}

/// `第[编号]卷`（"第一卷 风雪"，不锚定结尾）——编号紧贴卷字
fn is_di_volume(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('第') else {
        return false;
    };
    let mut digits = 0usize;
    for c in rest.chars() {
        if c == '卷' {
            return digits > 0;
        }
        if is_numeral(c) {
            digits += 1;
        } else {
            return false;
        }
    }
    false
}

/// `卷[编号]`（"卷一 风雪"）——无"第"字的卷行，网文常见
fn is_bare_volume(line: &str) -> bool {
    line.strip_prefix('卷').is_some_and(|rest| rest.chars().next().is_some_and(is_numeral))
}

/// 英文卷行 `Volume 1`（大小写不敏感）
fn is_english_volume(line: &str) -> bool {
    line.to_ascii_lowercase()
        .strip_prefix("volume")
        .and_then(|rest| rest.strip_prefix([' ', '\t']))
        .is_some_and(|rest| rest.chars().next().is_some_and(|c| c.is_ascii_digit()))
}

/// 卷行判定（split_segment 单独调用；卷只更新分组不单独成章）：
/// `第一卷` / `卷一` / `Volume 1`
fn is_volume_heading(line: &str) -> bool {
    is_di_volume(line) || is_bare_volume(line) || is_english_volume(line)
}

/// 章行：`第[编号][章回集部篇]`——编号紧贴单位字。
/// 规则源自 books-reader 的分章正则：
/// - 不含"节"——"第一节课开始"会误切（上游刻意排除）；
/// - 不做"第.{0,20}?章"松散匹配——"第一次集合"这类正文会误切；
/// - "第一章 初见"（空格副标题）由"不锚定结尾"覆盖——上游正则反而漏这种形式。
fn is_chapter_heading(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('第') else {
        return false;
    };
    let mut digits = 0usize;
    for c in rest.chars() {
        if matches!(c, '章' | '回' | '集' | '部' | '篇') {
            return digits > 0;
        }
        if is_numeral(c) {
            digits += 1;
        } else {
            return false;
        }
    }
    false
}

/// 罗马数字词（i/v/x/l/c/d/m 组成，≤4 字）——`Part III` / `Chapter XX`
fn is_roman_word(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 4
        && s.chars().all(|c| matches!(c, 'i' | 'v' | 'x' | 'l' | 'c' | 'd' | 'm'))
}

/// 英文章行：`Chapter 1` / `CHAPTER 12 The Gate` / `Part III` / `Prologue` / `Epilogue 尾声`
/// （大小写不敏感）。Chapter/Part 后必须跟阿拉伯数字或罗马数字，Prologue/Epilogue 后随意。
fn is_english_heading(line: &str) -> bool {
    let lower = line.to_ascii_lowercase();
    if lower.starts_with("prologue") || lower.starts_with("epilogue") {
        return true;
    }
    for prefix in ["chapter", "part"] {
        let Some(numbered) = lower
            .strip_prefix(prefix)
            .and_then(|rest| rest.strip_prefix([' ', '\t']))
            .map(|rest| {
                let word: String =
                    rest.chars().take_while(|c| c.is_ascii_digit() || is_roman_word_char(*c)).collect();
                !word.is_empty() && (word.chars().next().is_some_and(|c| c.is_ascii_digit()) || is_roman_word(&word))
            })
        else {
            continue;
        };
        if numbered {
            return true;
        }
    }
    false
}

fn is_roman_word_char(c: char) -> bool {
    matches!(c, 'i' | 'v' | 'x' | 'l' | 'c' | 'd' | 'm')
}

/// 数字编号章题：`1.标题` / `1、标题` / `01．标题`——数字后必须跟点/顿号，
/// 其后是标题文字；纯数字尾（"3.14159"）不算，防正文数字串误切。
fn is_numbered_heading(line: &str) -> bool {
    let digits: String = line.chars().take_while(|c| is_digit(*c)).collect();
    let n = digits.chars().count();
    if n == 0 || n > 4 {
        return false;
    }
    let mut rest = line[digits.len()..].chars();
    match rest.next() {
        Some('.' | '．' | '、') => {}
        _ => return false,
    }
    let title: String = rest.collect();
    let t = title.trim_matches([' ', '\t', '\u{3000}']);
    !t.is_empty() && !t.chars().all(|c| is_numeral(c) || matches!(c, '.' | '．'))
}

/// 标题行判定：命中章/特殊标记，且不以句读结尾、长度 ≤ 40。
/// 卷行不在此列（split_segment 单独拦截，卷只分组不单独成章）。
/// 末尾标点 + 行长两条 guard 是超出计划的正向补充——正文短句（如"第二天回家。"）
/// 和长句会被章规则误判，加上这两条判断可挡掉绝大多数误切。
fn heading_of(line: &str) -> Option<String> {
    if line.chars().count() > TITLE_LINE_MAX_CHARS {
        return None;
    }
    if line.chars().last().is_some_and(ends_with_sentence) {
        return None;
    }
    if is_chapter_heading(line) || is_english_heading(line) || is_numbered_heading(line) {
        return Some(truncate_chars(line, TITLE_MAX_CHARS));
    }
    if SPECIAL_MARKERS.iter().any(|m| line.starts_with(m)) {
        return Some(truncate_chars(line, TITLE_MAX_CHARS));
    }
    None
}

/// 去首尾空行（保留行内的段首缩进）
fn trim_blank(s: &str) -> String {
    let lines: Vec<&str> = s.lines().collect();
    let start = lines.iter().position(|l| !l.trim().is_empty()).unwrap_or(lines.len());
    let end = lines.iter().rposition(|l| !l.trim().is_empty()).map_or(start, |i| i + 1);
    lines[start..end].join("\n")
}

/// 段落规范化（导入落库前必经）：
/// - 剥掉段首的全角/半角空格缩进——网文 txt 普遍用「　　」缩进段首，
///   而编辑器/阅读模式的段首缩进由排版层负责，落库保留缩进会双重缩进；
/// - 单换行分隔的段落改为空行分隔——markdown 渲染按空行分段，
///   否则整章叠成一段（用户实测「段落叠在一起」）。
/// 已规范化的文本（空行分隔）原样通过（幂等）。
fn normalize_paragraphs(s: &str) -> String {
    s.lines()
        .map(|l| l.trim_matches([' ', '\t', '\u{3000}']))
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// 单个文档分章（BOM 分段后各段独立调用，避免前一段的卷状态串到下一段）
fn split_segment(segment: &str) -> Vec<ParsedChapter> {
    let mut out: Vec<ParsedChapter> = Vec::new();
    let mut volume: Option<String> = None;
    let mut current: Option<ParsedChapter> = None;
    let mut preamble = String::new();

    for raw in segment.lines() {
        let line = raw.trim_end();
        let trimmed = line.trim();
        if trimmed.is_empty() {
            let target = current.as_mut().map(|c| &mut c.content).unwrap_or(&mut preamble);
            target.push('\n');
            continue;
        }
        if is_volume_heading(trimmed) && !trimmed.chars().last().is_some_and(ends_with_sentence) {
            volume = Some(truncate_chars(trimmed, TITLE_MAX_CHARS));
            continue;
        }
        if let Some(title) = heading_of(trimmed) {
            if let Some(done) = current.take() {
                out.push(done);
            }
            current = Some(ParsedChapter { title, content: String::new(), volume: volume.clone() });
            continue;
        }
        let target = current.as_mut().map(|c| &mut c.content).unwrap_or(&mut preamble);
        target.push_str(line);
        target.push('\n');
    }
    if let Some(done) = current {
        out.push(done);
    }

    let body = trim_blank(&preamble);
    if out.is_empty() {
        // 无任何标题匹配 → 全文作为第一章
        if !body.is_empty() {
            out.push(ParsedChapter { title: "第一章".into(), content: body, volume });
        }
    } else if !body.is_empty() {
        // 标题之前有正文（罕见）：并入第一章开头，不丢字
        out[0].content = format!("{body}\n{}", out[0].content);
    }
    for c in &mut out {
        c.content = normalize_paragraphs(&trim_blank(&c.content));
    }
    out.retain(|c| !c.content.is_empty());
    out
}

/// 分章：`﻿` 分隔多文档，逐段独立分章。
/// 规则：卷行只更新当前卷（不单独成章）；章行/特殊标记行开新章；
/// 其余行为正文；无任何匹配时全文作第一章；章题截 `TITLE_MAX_CHARS`。
pub fn split_txt(text: &str) -> Vec<ParsedChapter> {
    text.split('\u{feff}')
        .filter(|s| !s.trim().is_empty())
        .flat_map(split_segment)
        .collect()
}

/// docx 读段落 → 拼成纯文本 → 复用同一套分章规则
pub fn import_docx(bytes: &[u8]) -> AppResult<Vec<ParsedChapter>> {
    let docx = docx_rs::read_docx(bytes).map_err(|e| AppError::Invalid(format!("docx 解析失败: {e}")))?;
    let mut text = String::new();
    for child in &docx.document.children {
        if let docx_rs::DocumentChild::Paragraph(p) = child {
            for pc in &p.children {
                if let docx_rs::ParagraphChild::Run(r) = pc {
                    for rc in &r.children {
                        match rc {
                            docx_rs::RunChild::Text(t) => text.push_str(&t.text),
                            docx_rs::RunChild::Tab(_) => text.push('\t'),
                            // 段内换行（Shift+Enter）按软换行处理，不另起段
                            docx_rs::RunChild::Break(_) => text.push('\n'),
                            _ => {}
                        }
                    }
                }
            }
        }
        text.push('\n');
    }
    Ok(split_txt(&text))
}

/// 读文件 → 按扩展名分派（.docx 走 docx 解析，其余按文本解码分章）
pub fn preview_import_inner(path: &Path) -> AppResult<Vec<ParsedChapter>> {
    let bytes = std::fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext == "docx" {
        import_docx(&bytes)
    } else {
        Ok(split_txt(&detect_and_decode(&bytes)))
    }
}

/// 批量建章并落盘。导入是"一次成型"的批量操作，**不走快照钩子**：
/// 首次导入的初稿没有回退价值，而逐章快照会让几百章的导入多出几百次写盘。
pub fn import_chapters_inner(
    s: &AppState,
    book_id: i64,
    chapters: &[ParsedChapter],
) -> AppResult<ImportReport> {
    let mut report = ImportReport { chapters: 0, words: 0 };
    for p in chapters {
        let ChapterMeta { id, .. } = commands::create_chapter_inner(s, book_id, &p.title)?;
        crate::fs_service::write_chapter(&s.root, &chapter_rel(s, id)?, &p.content)?;
        let wc = count_words(&p.content);
        lock(s).and_then(|conn| repo::chapters::touch_content(&*conn, id, wc))?;
        report.chapters += 1;
        report.words += wc;
    }
    Ok(report)
}

fn chapter_rel(s: &AppState, id: i64) -> AppResult<String> {
    Ok(lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?.file_path)
}
