//! M1-T3 ContextAssembler 组装器行为测试（组装语义逐条锁形）。

use bixian::context::{assemble, AssembleInput, AssemblyLog, CHAPTER_WINDOW_CHARS, PREV_WINDOW_CHARS};
use bixian::util::estimate_tokens;

const BOOK: &str = "长夜余火";
const INSTRUCTION: &str = "继续写下一幕";

fn input<'a>(
    style: Option<&'a str>,
    chapter: &'a str,
    prev: Option<&'a str>,
    instruction: &'a str,
) -> AssembleInput<'a> {
    AssembleInput {
        book_title: BOOK,
        style_prompt: style,
        chapter_text: chapter,
        prev_chapter_tail: prev,
        instruction,
        injections: Vec::new(),
    }
}

fn injection(name: &str, source: &str, text: &str, budget: usize) -> bixian::context::InjectionInput {
    bixian::context::InjectionInput {
        name: name.to_string(),
        source: source.to_string(),
        text: text.to_string(),
        budget,
    }
}

fn default_system(book: &str) -> String {
    format!("你是长篇小说《{book}》的合著者。续写须与既有正文风格、人称、时态保持一致，直接输出正文，不要解释。")
}

fn slot_names(log: &AssemblyLog) -> Vec<&str> {
    log.slots.iter().map(|s| s.name.as_str()).collect()
}

// ---------- estimate_tokens ----------

#[test]
fn estimate_tokens_mixed_cjk_latin_is_bounded() {
    let est = estimate_tokens("你好 world");
    assert!((4..=6).contains(&est), "期望 4..=6，实际 {est}");
}

#[test]
fn estimate_tokens_pure_cjk_is_about_1_6x() {
    assert_eq!(estimate_tokens("一二三四五六七八九十"), 16);
}

#[test]
fn estimate_tokens_empty_text_is_zero() {
    assert_eq!(estimate_tokens(""), 0);
}

// ---------- system 拼接 ----------

#[test]
fn system_without_style_is_default_prompt_only() {
    let out = assemble(&input(None, "已有正文。", None, INSTRUCTION));
    assert_eq!(out.system, default_system(BOOK));
    assert_eq!(slot_names(&out.log), vec!["System", "当前章正文", "写作指令"]);
}

#[test]
fn system_with_style_appends_style_section() {
    let style = "冷峻克制，短句为主。";
    let out = assemble(&input(Some(style), "已有正文。", None, INSTRUCTION));
    assert_eq!(out.system, format!("{}\n\n【文风要求】\n{style}", default_system(BOOK)));
    assert_eq!(slot_names(&out.log), vec!["System", "文风", "当前章正文", "写作指令"]);
    let style_slot = out.log.slots.iter().find(|s| s.name == "文风").unwrap();
    assert_eq!(style_slot.chars, style.chars().count() as i64);
}

// ---------- 当前章正文窗口 ----------

#[test]
fn long_chapter_tail_window_keeps_tail_at_char_count() {
    // 5000 个中文字符（15000 字节）：前半「前」后半「后」
    let text: String = (0..5000).map(|i| if i < 2500 { '前' } else { '后' }).collect();
    let out = assemble(&input(None, &text, None, INSTRUCTION));

    let suffix = format!("\n\n【写作指令】\n{INSTRUCTION}");
    let body = out
        .user
        .strip_prefix("【当前章节已有正文（尾部）】\n")
        .unwrap()
        .strip_suffix(suffix.as_str())
        .unwrap();
    // 按字符计数截断到窗口大小（非字节）
    assert_eq!(body.chars().count(), CHAPTER_WINDOW_CHARS);
    // 保留尾部：跳过开头 1000 个「前」→ 尾窗 = 1500 前 + 2500 后
    assert_eq!(body.chars().filter(|&c| c == '前').count(), 1500);
    assert_eq!(body.chars().filter(|&c| c == '后').count(), 2500);
    // 槽位字符数 = 窗口字符数
    let slot = out.log.slots.iter().find(|s| s.name == "当前章正文").unwrap();
    assert_eq!(slot.chars, CHAPTER_WINDOW_CHARS as i64);
}

#[test]
fn short_chapter_kept_whole() {
    let text = "短短几行。";
    let out = assemble(&input(None, text, None, INSTRUCTION));
    assert_eq!(
        out.user,
        format!("【当前章节已有正文（尾部）】\n{text}\n\n【写作指令】\n{INSTRUCTION}")
    );
    let slot = out.log.slots.iter().find(|s| s.name == "当前章正文").unwrap();
    assert_eq!(slot.chars, text.chars().count() as i64);
}

#[test]
fn empty_chapter_user_is_instruction_only() {
    let out = assemble(&input(None, "", None, INSTRUCTION));
    assert_eq!(out.user, INSTRUCTION);
    assert_eq!(slot_names(&out.log), vec!["System", "写作指令"]);
}

// ---------- 上一章结尾 ----------

#[test]
fn prev_chapter_tail_becomes_first_history_entry() {
    let prev = "上一章的结尾内容。";
    let out = assemble(&input(None, "正文。", Some(prev), INSTRUCTION));
    assert_eq!(out.history.len(), 1);
    assert_eq!(out.history[0].0, "user");
    assert_eq!(out.history[0].1, format!("【上一章结尾】\n{prev}"));
}

#[test]
fn prev_chapter_overlong_windowed_to_tail() {
    let prev: String = "章".repeat(1500);
    let out = assemble(&input(None, "正文。", Some(&prev), INSTRUCTION));
    assert_eq!(out.history.len(), 1);
    let body = out.history[0].1.strip_prefix("【上一章结尾】\n").unwrap();
    assert_eq!(body.chars().count(), PREV_WINDOW_CHARS);
    assert!(prev.ends_with(body), "窗口应保留上一章尾部");
}

#[test]
fn no_prev_chapter_history_is_empty() {
    let out = assemble(&input(None, "正文。", None, INSTRUCTION));
    assert!(out.history.is_empty());
}

// ---------- 槽位日志 ----------

#[test]
fn all_slots_present_in_fixed_order() {
    let out = assemble(&input(Some("华丽辞藻。"), "当前正文。", Some("前情提要。"), INSTRUCTION));
    assert_eq!(
        slot_names(&out.log),
        vec!["System", "文风", "上一章结尾", "当前章正文", "写作指令"]
    );
}

#[test]
fn slot_log_fields_and_total_are_consistent() {
    let out = assemble(&input(Some("简洁。"), "正文字数足够。", Some("前文。"), INSTRUCTION));

    let total: i64 = out.log.slots.iter().map(|s| s.est_tokens).sum();
    assert_eq!(out.log.total_est_tokens, total);
    for s in &out.log.slots {
        // 纯中文槽位：估算 token（×1.6）应大于字符数
        assert!(s.est_tokens > s.chars, "槽位 {} 应 est_tokens > chars", s.name);
        assert!(s.preview_head.chars().count() <= 120);
    }
}

#[test]
fn preview_head_caps_at_120_chars_without_ellipsis() {
    let instruction: String = "指".repeat(300);
    let out = assemble(&input(None, "", None, &instruction));
    let slot = out.log.slots.iter().find(|s| s.name == "写作指令").unwrap();
    assert_eq!(slot.preview_head.chars().count(), 120);
    assert_eq!(slot.preview_head, "指".repeat(120));
    assert!(!slot.preview_head.contains('…'), "截断不加省略号");
}

#[test]
fn assembly_log_serializes_snake_case_fields() {
    let out = assemble(&input(None, "正文。", None, INSTRUCTION));
    let json = serde_json::to_string(&out.log).unwrap();
    assert!(json.contains(r#""slots""#));
    assert!(json.contains(r#""total_est_tokens""#));
    assert!(json.contains(r#""est_tokens""#));
    assert!(json.contains(r#""preview_head""#));
}

// ---------- 注入原子槽位（M7 批次6） ----------

#[test]
fn injections_sit_between_style_and_prev_chapter() {
    let mut inp = input(Some("华丽辞藻。"), "当前正文。", Some("前情提要。"), INSTRUCTION);
    inp.injections = vec![
        injection("角色卡", "关键词命中 1 人", "- 林远山（主角）：沉默寡言。", 0),
        injection("伏笔提醒", "未回收 1 条", "- 「夜归人」第1章埋设", 0),
    ];
    let out = assemble(&inp);
    assert_eq!(
        slot_names(&out.log),
        vec!["System", "文风", "角色卡", "伏笔提醒", "上一章结尾", "当前章正文", "写作指令"]
    );
    // 注入文本拼进 system，各自带标题段
    assert!(out.system.contains("\n\n【角色卡】\n- 林远山"));
    assert!(out.system.contains("\n\n【伏笔提醒】\n- 「夜归人」"));
    // 文风段仍在注入之前
    let style_pos = out.system.find("【文风要求】").unwrap();
    let char_pos = out.system.find("【角色卡】").unwrap();
    assert!(style_pos < char_pos);
    // 注入不进 history（history 只认上一章结尾）
    assert_eq!(out.history.len(), 1);
}

#[test]
fn injection_budget_truncates_from_head_and_zero_means_unlimited() {
    let long: String = (0..50).map(|i| char::from_u32(0x4e00 + i as u32).unwrap()).collect();
    let unlimited: String = (0..50).map(|i| char::from_u32(0x9fa5 - i as u32).unwrap()).collect();
    let mut inp = input(None, "正文。", None, INSTRUCTION);
    inp.injections = vec![
        injection("情节块", "勾选 1 块", &long, 20),
        injection("灵感卡", "勾选 1 张", &unlimited, 0),
    ];
    let out = assemble(&inp);
    let plot = out.log.slots.iter().find(|s| s.name == "情节块").unwrap();
    assert_eq!(plot.chars, 20);
    let kept: String = long.chars().take(20).collect();
    assert!(out.system.contains(&kept));
    assert!(!out.system.contains(&long), "超预算部分不进 system");
    let idea = out.log.slots.iter().find(|s| s.name == "灵感卡").unwrap();
    assert_eq!(idea.chars, 50, "budget=0 不限");
    assert!(out.system.contains(&unlimited));
}

#[test]
fn empty_injection_is_skipped_without_slot_or_heading() {
    let mut inp = input(None, "正文。", None, INSTRUCTION);
    inp.injections = vec![injection("角色卡", "关键词命中 0 人", "", 1500)];
    let out = assemble(&inp);
    assert_eq!(slot_names(&out.log), vec!["System", "当前章正文", "写作指令"]);
    assert!(!out.system.contains("【角色卡】"));
}
