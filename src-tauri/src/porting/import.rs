//! M2-T8 导入：编码检测 + 分章 + 批量落库。
//!
//! 分章规则还原自作家助手 importUtil 并做增强（见 `split_txt`）。
//! `detect_and_decode` 用 chardetng 猜编码、encoding_rs 解码（GBK/GB18030/UTF-8 等）。

use std::path::Path;

use regex::Regex;
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

/// 自定义分章规则（settings 表 customChapterRules 键，M4-T2）。
/// 行内命中即视为章题行，但仍先过句读/长度两条 guard
/// （guard 是普适防误切，用户规则只加覆盖不豁免）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomChapterRule {
    pub name: String,
    pub pattern: String,
}

/// 规则数/长度上限：设置值可被外部 db 写入，信任边界处兜底防正则炸裂
pub const CUSTOM_RULES_MAX: usize = 20;
pub const CUSTOM_RULE_PATTERN_MAX: usize = 200;

/// 读用户自定义规则并编译；坏 JSON / 坏正则 / 超限一律跳过不炸（导入绝不能因规则挂掉）
pub fn load_custom_rules(s: &AppState) -> Vec<Regex> {
    let raw = commands::setting_get_inner(s, "customChapterRules")
        .ok()
        .flatten()
        .unwrap_or_default();
    let Ok(list) = serde_json::from_str::<Vec<CustomChapterRule>>(&raw) else {
        return Vec::new();
    };
    list.into_iter()
        .take(CUSTOM_RULES_MAX)
        .filter(|r| !r.pattern.is_empty() && r.pattern.len() <= CUSTOM_RULE_PATTERN_MAX)
        .filter_map(|r| Regex::new(&r.pattern).ok())
        .collect()
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
fn heading_of(line: &str, custom: &[Regex]) -> Option<String> {
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
    if custom.iter().any(|r| r.is_match(line)) {
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
fn split_segment(segment: &str, custom: &[Regex]) -> Vec<ParsedChapter> {
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
        if let Some(title) = heading_of(trimmed, custom) {
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
    split_txt_with(text, &[])
}

/// 带自定义规则的分章（M4-T2：preview_import 用，内置规则先判、用户规则补覆盖）
pub fn split_txt_with(text: &str, custom: &[Regex]) -> Vec<ParsedChapter> {
    text.split('\u{feff}')
        .filter(|s| !s.trim().is_empty())
        .flat_map(|s| split_segment(s, custom))
        .collect()
}

/// docx 读段落 → 拼成纯文本（分章由调用方决定用哪套规则）
fn docx_to_text(bytes: &[u8]) -> AppResult<String> {
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
    Ok(text)
}

/// docx 导入（内置规则分章；tests/porting_test.rs 依赖此签名）
pub fn import_docx(bytes: &[u8]) -> AppResult<Vec<ParsedChapter>> {
    Ok(split_txt(&docx_to_text(bytes)?))
}

/// 读文件 → 按扩展名分派（.docx 走 docx 解析，其余按文本解码分章）；
/// custom 为用户自定义规则（M4-T2，两条路径都生效）
pub fn preview_import_inner(path: &Path, custom: &[Regex]) -> AppResult<Vec<ParsedChapter>> {
    let bytes = std::fs::read(path)?;
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if ext == "docx" {
        Ok(split_txt_with(&docx_to_text(&bytes)?, custom))
    } else {
        Ok(split_txt_with(&detect_and_decode(&bytes), custom))
    }
}

/// 自然序比较：连续数字段按数值比、其余按字符比（"2" < "10"，folderBook 同款）
fn nat_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a, b);
    loop {
        let (ad, bd) = (a.chars().next(), b.chars().next());
        match (ad, bd) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let na = take_digits_run(&mut a);
                let nb = take_digits_run(&mut b);
                let (za, zb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = za.len().cmp(&zb.len()).then_with(|| za.cmp(zb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                a = &a[x.len_utf8()..];
                b = &b[y.len_utf8()..];
            }
        }
    }
}

fn take_digits_run(s: &mut &str) -> String {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (run, rest) = s.split_at(end);
    *s = rest;
    run.to_string()
}

/// 文件名去序号作章题：剥前导数字串+分隔符，再剥「第X章」式前缀；剥完为空保留原名
fn strip_serial(stem: &str) -> String {
    let s = stem.trim();
    let no_digits = s.trim_start_matches(|c: char| is_digit(c));
    let no_digits = no_digits.trim_start_matches(['.', '．', '、', '-', '_', ' ', '\u{3000}']);
    let step1 = if no_digits.is_empty() { s } else { no_digits };
    if let Some(rest) = step1.strip_prefix('第') {
        if let Some((ui, uc)) = rest
            .char_indices()
            .find(|(_, c)| matches!(c, '章' | '卷' | '回' | '集' | '部' | '篇'))
        {
            let mid = &rest[..ui];
            let after = rest[ui + uc.len_utf8()..]
                .trim_start_matches(['.', '．', '、', '-', '_', ' ', '\u{3000}', ':', '：']);
            if !mid.is_empty() && mid.chars().all(is_numeral) && !after.is_empty() {
                return truncate_chars(after, TITLE_MAX_CHARS);
            }
        }
    }
    truncate_chars(step1, TITLE_MAX_CHARS)
}

/// 文件夹成书导入（M4-T3）：*.md / *.txt 按文件名自然序，一文件一章。
/// 不递归子目录；docx 不收（二进制混排无意义）。
/// 章题取文件名去序号；剥完纯数字（"2.txt" 这类无名义文件名）时回退用正文首行。
pub fn preview_import_dir_inner(path: &Path) -> AppResult<Vec<ParsedChapter>> {
    let mut entries: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(path)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension()?.to_str()?.to_ascii_lowercase();
            if ext != "md" && ext != "txt" {
                return None;
            }
            Some((p.file_stem()?.to_str()?.to_string(), p))
        })
        .collect();
    entries.sort_by(|a, b| nat_cmp(&a.0, &b.0));
    let mut out = Vec::new();
    for (stem, p) in entries {
        let bytes = std::fs::read(&p)?;
        let content = normalize_paragraphs(&trim_blank(&detect_and_decode(&bytes)));
        if content.is_empty() {
            continue;
        }
        let stripped = strip_serial(&stem);
        let title = if stripped.chars().all(is_digit) {
            content
                .lines()
                .find(|l| !l.trim().is_empty())
                .map(|l| truncate_chars(l.trim(), TITLE_MAX_CHARS))
                .unwrap_or(stripped)
        } else {
            stripped
        };
        out.push(ParsedChapter { title, content, volume: None });
    }
    Ok(out)
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

#[cfg(test)]
mod custom_rule_tests {
    use super::*;

    fn rules(pats: &[&str]) -> Vec<Regex> {
        pats.iter().map(|p| Regex::new(p).unwrap()).collect()
    }

    #[test]
    fn custom_rule_splits_where_builtins_do_not() {
        let text = "开头一段。\n【风起】\n风起了。\n【云落】\n云散了。";
        let out = split_txt_with(text, &rules(&["^【.+】$"]));
        assert_eq!(out.len(), 2, "两条自定义章题行各开一章: {out:?}");
        assert_eq!(out[0].title, "【风起】");
        assert_eq!(out[1].title, "【云落】");
    }

    #[test]
    fn custom_rules_respect_sentence_and_length_guards() {
        // 句读结尾的行即便是规则命中也不是标题（guard 先于自定义规则）
        let out = split_txt_with("【风起。】\n正文", &rules(&["^【.+】$"]));
        assert_eq!(out.len(), 1, "以句号结尾的行不切章: {out:?}");
        // 超长行同理（>40 字符）
        let long = format!("【{}】", "很".repeat(50));
        let out2 = split_txt_with(&format!("{long}\n正文"), &rules(&["^【.+】$"]));
        assert_eq!(out2.len(), 1);
    }

    #[test]
    fn load_custom_rules_reads_settings_and_skips_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        let s = AppState::test_state(tmp.path());
        commands::setting_set_inner(
            &s,
            "customChapterRules",
            r#"[{"name":"卷头","pattern":"^卷[一二三]$"},{"name":"坏","pattern":"("}]"#,
        )
        .unwrap();
        let rs = load_custom_rules(&s);
        assert_eq!(rs.len(), 1, "坏正则跳过不炸: {rs:?}");

        // 无配置 / 坏 JSON → 空
        commands::setting_set_inner(&s, "customChapterRules", "{{{").unwrap();
        assert!(load_custom_rules(&s).is_empty());
    }

    #[test]
    fn nat_cmp_sorts_numbers_numerically() {
        let mut names = vec!["10.md".to_string(), "2.md".to_string(), "1.md".to_string()];
        names.sort_by(|a, b| nat_cmp(a, b));
        assert_eq!(names, vec!["1.md", "2.md", "10.md"]);
    }

    #[test]
    fn strip_serial_variants() {
        assert_eq!(strip_serial("001 风雪"), "风雪");
        assert_eq!(strip_serial("001"), "001", "剥完为空则保留原名");
        assert_eq!(strip_serial("第12章 风雪"), "风雪");
        assert_eq!(strip_serial("第十二章-风雪"), "风雪");
        assert_eq!(strip_serial("楔子"), "楔子");
    }

    #[test]
    fn preview_import_dir_orders_and_titles() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("book");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("10.md"), "第十章正文\n\n第二段").unwrap();
        std::fs::write(dir.join("2.txt"), "第二章正文").unwrap();
        std::fs::write(dir.join("封面.png"), b"png").unwrap(); // 非文本跳过
        std::fs::write(dir.join("001 开端.md"), "开端正文").unwrap();
        let out = preview_import_dir_inner(&dir).unwrap();
        assert_eq!(
            out.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(),
            vec!["开端", "第二章正文", "第十章正文"],
            "自然序排列；文件名去序号作章题，纯数字文件名回退正文首行"
        );
        assert!(out[0].content.contains("开端正文"));
    }
}
