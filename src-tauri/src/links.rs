//! M7 批次3：wiki 双链与人物提及。
//! 链接以 `[[章题]]` 纯文本活在 md 正文里（md 是真源），此处按需扫描派生：
//! 出链/反链按「同书章题精确匹配」消解；人物提及按姓名+别名做包含计数。
//! 不落库——章内容改了扫描结果自动跟上，无需写钩子。

use std::collections::HashMap;

use regex::Regex;

use crate::commands::lock;
use crate::error::AppResult;
use crate::fs_service;
use crate::models::{Backlink, CharacterMention, WikiLink};
use crate::repo::{chapters, characters};
use crate::state::AppState;

/// 正文里 wiki 链接的匹配段（目标 + 上下文摘录）
struct RawLink {
    target: String,
    snippet: String,
}

/// 从一段文本提取所有 `[[目标]]`；摘录取匹配处前后各 20 字符（字符边界安全）。
fn extract_links(text: &str, re: &Regex) -> Vec<RawLink> {
    re.captures_iter(text)
        .map(|c| {
            let m = c.get(0).expect("捕获组 0 必然存在");
            let start = {
                let mut i = m.start().saturating_sub(20);
                while i > 0 && !text.is_char_boundary(i) {
                    i -= 1;
                }
                i
            };
            let end = {
                let mut i = (m.end() + 20).min(text.len());
                while i < text.len() && !text.is_char_boundary(i) {
                    i += 1;
                }
                i
            };
            RawLink {
                target: c[1].trim().to_string(),
                snippet: text[start..end].replace('\n', " "),
            }
        })
        .collect()
}

/// 全书扫描：每章的出链（含未解析目标）。章题重复时消解到 sort_key 最靠前的章。
pub fn scan_book(s: &AppState, book_id: i64) -> AppResult<Vec<WikiLink>> {
    let conn = lock(s)?;
    let list = chapters::list_by_book(&conn, book_id)?;
    drop(conn);

    let re = Regex::new(r"\[\[([^\[\]]+?)\]\]").expect("链接正则合法");
    // 章题 → 首个同题章 id（重复章题取目录序最前）
    let mut id_by_title: HashMap<&str, i64> = HashMap::new();
    for ch in &list {
        id_by_title.entry(ch.title.as_str()).or_insert(ch.id);
    }

    let mut out = Vec::new();
    for ch in &list {
        let content = fs_service::read_chapter(&s.root, &ch.file_path).unwrap_or_default();
        for raw in extract_links(&content, &re) {
            let resolved = id_by_title.get(raw.target.as_str()).copied();
            out.push(WikiLink {
                from_id: ch.id,
                from_title: ch.title.clone(),
                to_id: resolved,
                to_title: resolved.map(|id| {
                    list.iter()
                        .find(|c| c.id == id)
                        .map(|c| c.title.clone())
                        .unwrap_or_default()
                }),
                target: raw.target,
                snippet: raw.snippet,
            });
        }
    }
    Ok(out)
}

/// 反向链接：哪些章的正文链到本章（自引除外；软删章不在扫描范围自然不算）。
pub fn backlinks_for(s: &AppState, chapter_id: i64) -> AppResult<Vec<Backlink>> {
    let conn = lock(s)?;
    let ch = chapters::get(&conn, chapter_id)?;
    drop(conn);

    Ok(scan_book(s, ch.book_id)?
        .into_iter()
        .filter(|l| l.to_id == Some(chapter_id) && l.from_id != chapter_id)
        .map(|l| Backlink { from_id: l.from_id, from_title: l.from_title, snippet: l.snippet })
        .collect())
}

/// 人物提及：姓名与别名（逗号/顿号分隔）同权，逐章做不重叠包含计数；零提及不返回。
pub fn mentions(s: &AppState, book_id: i64) -> AppResult<Vec<CharacterMention>> {
    let conn = lock(s)?;
    let chars = characters::list_by_book(&conn, book_id)?;
    let list = chapters::list_by_book(&conn, book_id)?;
    drop(conn);

    // 预读全部章内容（本地 md，量级可控）
    let contents: Vec<(i64, String)> = list
        .iter()
        .map(|ch| {
            (
                ch.id,
                fs_service::read_chapter(&s.root, &ch.file_path).unwrap_or_default(),
            )
        })
        .collect();

    let mut out = Vec::new();
    for ch in &chars {
        let mut names: Vec<&str> = vec![ch.name.as_str()];
        names.extend(
            ch.aliases
                .split([',', '，', '、'])
                .map(str::trim)
                .filter(|n| !n.is_empty()),
        );
        for (cid, ctitle) in list.iter().map(|c| (c.id, &c.title)) {
            let content = &contents.iter().find(|(id, _)| *id == cid).expect("同源列表").1;
            let count: i64 = names.iter().map(|n| content.matches(*n).count() as i64).sum();
            if count > 0 {
                out.push(CharacterMention {
                    character_id: ch.id,
                    name: ch.name.clone(),
                    chapter_id: cid,
                    chapter_title: ctitle.clone(),
                    count,
                });
            }
        }
    }
    Ok(out)
}
