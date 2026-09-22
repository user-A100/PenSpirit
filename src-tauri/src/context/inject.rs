//! M7 批次6 注入原子收集：读每书配置（settings `context:book:{id}`），
//! 把角色卡/伏笔/情节块/灵感卡渲染成注入槽位文本。装配器只做预算截断，
//! 触发语义（关键词命中 / 未回收自动列 / 手动勾选）全部收在本模块。
use rusqlite::Connection;

use crate::context::assembler::InjectionInput;
use crate::error::{AppError, AppResult};
use crate::models::{default_context_config, ContextConfig, Foreshadow};
use crate::repo;

const CONFIG_KEY_PREFIX: &str = "context:book:";

/// 读每书注入配置；无记录时返回默认（角色卡/伏笔开，情节块/灵感关）。
pub fn load_config(conn: &Connection, book_id: i64) -> AppResult<ContextConfig> {
    match repo::settings::get(conn, &format!("{CONFIG_KEY_PREFIX}{book_id}"))? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| AppError::Db(format!("注入配置数据损坏: {e}"))),
        None => Ok(default_context_config()),
    }
}

/// 保存每书注入配置（整体覆盖）。
pub fn store_config(conn: &Connection, book_id: i64, cfg: &ContextConfig) -> AppResult<()> {
    let json = serde_json::to_string(cfg)
        .map_err(|e| AppError::Db(format!("注入配置序列化失败: {e}")))?;
    repo::settings::set(conn, &format!("{CONFIG_KEY_PREFIX}{book_id}"), &json)
}

/// 逗号分隔别名 → 非空别名列表。
fn split_aliases(aliases: &str) -> Vec<&str> {
    aliases.split(',').map(str::trim).filter(|a| !a.is_empty()).collect()
}

/// 角色卡注入文本：`- 名（角色；别名：a/b）：小传`。空段自动省略。
fn character_line(name: &str, role: &str, aliases: &[&str], description: &str) -> String {
    let mut head = format!("- {name}");
    let mut meta: Vec<String> = Vec::new();
    if !role.is_empty() {
        meta.push(role.to_string());
    }
    if !aliases.is_empty() {
        meta.push(format!("别名：{}", aliases.join("/")));
    }
    if !meta.is_empty() {
        head.push_str(&format!("（{}）", meta.join("；")));
    }
    if !description.is_empty() {
        head.push_str(&format!("：{description}"));
    }
    head
}

/// 伏笔注入文本：`- 「题」第n章埋设（距当前 d 章），计划第m章回收：备注`。
fn foreshadow_line(
    fs: &Foreshadow,
    planted_ord: Option<i64>,
    target_ord: Option<i64>,
    distance: Option<i64>,
) -> String {
    let mut line = format!("- 「{}」", fs.title);
    match planted_ord {
        Some(n) => line.push_str(&format!("第{n}章埋设")),
        None => line.push_str("埋设章已删"),
    }
    if let Some(d) = distance {
        line.push_str(&format!("（距当前 {d} 章）"));
    }
    if let Some(m) = target_ord {
        line.push_str(&format!("，计划第{m}章回收"));
    }
    let note = if fs.override_note.is_empty() { &fs.note } else { &fs.override_note };
    if !note.is_empty() {
        line.push_str(&format!("：{note}"));
    }
    line
}

/// 收集全部启用槽位（保持 角色卡→伏笔→情节块→灵感卡 固定序）。
/// current_chapter_id 用于伏笔「距当前 N 章」；None 时不标距离。
pub fn collect(
    conn: &Connection,
    book_id: i64,
    current_chapter_id: Option<i64>,
    chapter_text: &str,
) -> AppResult<Vec<InjectionInput>> {
    let cfg = load_config(conn, book_id)?;
    let mut out = Vec::new();

    // ---- 角色卡：关键词命中（名/别名出现在当前章正文），all=true 全量 ----
    if cfg.characters.enabled {
        let chars = repo::characters::list_by_book(conn, book_id)?;
        let low = chapter_text.to_lowercase();
        let hits: Vec<_> = chars
            .iter()
            .filter(|c| {
                cfg.characters.all
                    || (!c.name.is_empty() && low.contains(&c.name.to_lowercase()))
                    || split_aliases(&c.aliases)
                        .iter()
                        .any(|a| low.contains(&a.to_lowercase()))
            })
            .collect();
        if !hits.is_empty() {
            let source = if cfg.characters.all {
                format!("全量注入 {} 人", hits.len())
            } else {
                format!("关键词命中 {} 人", hits.len())
            };
            let text = hits
                .iter()
                .map(|c| character_line(&c.name, &c.role, &split_aliases(&c.aliases), &c.description))
                .collect::<Vec<_>>()
                .join("\n");
            out.push(InjectionInput {
                name: "角色卡".into(),
                source,
                text,
                budget: cfg.characters.budget.max(0) as usize,
            });
        }
    }

    // ---- 伏笔提醒：未回收（active）自动列出，可 ids 圈定 ----
    if cfg.foreshadows.enabled {
        let chapters = repo::chapters::list_by_book(conn, book_id)?;
        let ord_of = |id: i64| {
            chapters
                .iter()
                .position(|c| c.id == id)
                .map(|i| (i + 1) as i64)
        };
        let cur_ord = current_chapter_id.and_then(&ord_of);
        let all_fs = repo::foreshadows::list_by_book(conn, book_id)?;
        let actives: Vec<_> = all_fs
            .iter()
            .filter(|f| f.status == "active")
            .filter(|f| cfg.foreshadows.ids.as_ref().map_or(true, |ids| ids.contains(&f.id)))
            .collect();
        if !actives.is_empty() {
            let text = actives
                .iter()
                .map(|f| {
                    let planted_ord = ord_of(f.planted_chapter_id);
                    let target_ord = f.target_chapter_id.and_then(&ord_of);
                    // 距当前 = 当前章序 - 埋设章序（埋设在未来章/已删时不标）
                    let distance = match (cur_ord, planted_ord) {
                        (Some(c), Some(p)) if c >= p => Some(c - p),
                        _ => None,
                    };
                    foreshadow_line(f, planted_ord, target_ord, distance)
                })
                .collect::<Vec<_>>()
                .join("\n");
            out.push(InjectionInput {
                name: "伏笔提醒".into(),
                source: format!("未回收 {} 条", actives.len()),
                text,
                budget: cfg.foreshadows.budget.max(0) as usize,
            });
        }
    }

    // ---- 情节块：手动勾选（ids=None 视为全部）----
    if cfg.plots.enabled {
        let blocks = repo::plot_blocks::list_by_book(conn, book_id)?;
        let picked: Vec<_> = blocks
            .iter()
            .filter(|b| cfg.plots.ids.as_ref().map_or(true, |ids| ids.contains(&b.id)))
            .collect();
        if !picked.is_empty() {
            let source = if cfg.plots.ids.is_some() {
                format!("勾选 {} 块", picked.len())
            } else {
                format!("全部 {} 块", picked.len())
            };
            let text = picked
                .iter()
                .map(|b| format!("- {}", b.content))
                .collect::<Vec<_>>()
                .join("\n");
            out.push(InjectionInput {
                name: "情节块".into(),
                source,
                text,
                budget: cfg.plots.budget.max(0) as usize,
            });
        }
    }

    // ---- 灵感卡：手动勾选（全局池，ids=None 视为全部）----
    if cfg.ideas.enabled {
        let ideas = repo::ideas::list(conn)?;
        let picked: Vec<_> = ideas
            .iter()
            .filter(|i| cfg.ideas.ids.as_ref().map_or(true, |ids| ids.contains(&i.id)))
            .collect();
        if !picked.is_empty() {
            let source = if cfg.ideas.ids.is_some() {
                format!("勾选 {} 张", picked.len())
            } else {
                format!("全部 {} 张", picked.len())
            };
            let text = picked
                .iter()
                .map(|i| {
                    let words: Vec<String> = serde_json::from_str(&i.words_json).unwrap_or_default();
                    let mut line = String::from("- ");
                    if !words.is_empty() {
                        line.push_str(&words.join(" · "));
                        if !i.content.is_empty() {
                            line.push_str("：");
                        }
                    }
                    line.push_str(&i.content);
                    line
                })
                .collect::<Vec<_>>()
                .join("\n");
            out.push(InjectionInput {
                name: "灵感卡".into(),
                source,
                text,
                budget: cfg.ideas.budget.max(0) as usize,
            });
        }
    }

    Ok(out)
}
