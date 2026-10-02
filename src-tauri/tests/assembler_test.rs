//! M1-T3 ContextAssembler 组装器行为测试（组装语义逐条锁形）。

use bixian::context::{
    assemble, trim_history, AssembleInput, AssemblyLog, Mode, AFTER_WINDOW_CHARS, CHAPTER_WINDOW_CHARS,
    PREV_WINDOW_CHARS,
};
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
        ..Default::default()
    }
}

fn h(role: &str, content: &str) -> (String, String) {
    (role.to_string(), content.to_string())
}

fn injection(name: &str, source: &str, text: &str, budget: usize) -> bixian::context::InjectionInput {
    bixian::context::InjectionInput {
        name: name.to_string(),
        source: source.to_string(),
        text: text.to_string(),
        budget,
        reason: String::new(),
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

// 阶段 2A：上一章结尾改放 system 前情段（history 只留真实对话，角色严格交替）
#[test]
fn prev_chapter_tail_goes_into_system_not_history() {
    let prev = "上一章的结尾内容。";
    let out = assemble(&input(None, "正文。", Some(prev), INSTRUCTION));
    assert!(out.history.is_empty());
    assert!(out.system.ends_with(&format!("\n\n【上一章结尾】\n{prev}")));
}

#[test]
fn prev_chapter_overlong_windowed_to_tail() {
    let prev: String = "章".repeat(1500);
    let out = assemble(&input(None, "正文。", Some(&prev), INSTRUCTION));
    let body = out.system.split("【上一章结尾】\n").nth(1).unwrap();
    assert_eq!(body.chars().count(), PREV_WINDOW_CHARS);
    assert!(prev.ends_with(body), "窗口应保留上一章尾部");
}

#[test]
fn no_prev_chapter_history_is_empty() {
    let out = assemble(&input(None, "正文。", None, INSTRUCTION));
    assert!(out.history.is_empty());
    assert!(!out.system.contains("【上一章结尾】"));
}

// ---------- 阶段 2A：多轮 / 模式 / 光标 / 槽位开关 / 长度 ----------

#[test]
fn history_is_passed_through_and_logged() {
    let mut inp = input(None, "正文。", None, "再紧凑一点");
    inp.history = vec![h("user", "写他推门进屋"), h("assistant", "他推开门，屋里一片漆黑。")];
    let out = assemble(&inp);
    assert_eq!(out.history, inp.history);
    assert_eq!(slot_names(&out.log), vec!["System", "对话历史", "当前章正文", "写作指令"]);
    assert_eq!(out.log.slots[1].source, "最近 2 条");
}

#[test]
fn trim_history_respects_mode_budgets_and_normalizes_roles() {
    // 写正文模式最多 4 条
    let many: Vec<_> = (0..10).map(|i| h(if i % 2 == 0 { "user" } else { "assistant" }, &format!("第{i}条"))).collect();
    let w = trim_history(&many, Mode::Write);
    assert_eq!(w.len(), 4);
    assert_eq!(w.last().unwrap().1, "第9条");
    assert_eq!(w[0].0, "user", "裁剪后以 user 开头");
    // 讨论模式可更多
    assert_eq!(trim_history(&many, Mode::Discuss).len(), 10);
    // 字数预算：单条超预算只保留尾部，且不会再塞更早的
    let long = "长".repeat(5000);
    let t = trim_history(&[h("user", "早先"), h("user", &long)], Mode::Write);
    assert_eq!(t.len(), 1);
    assert_eq!(t[0].1.chars().count(), 4000);
    // 开头的 assistant 丢弃，相邻同角色合并
    let n = trim_history(&[h("assistant", "孤儿回答"), h("user", "甲"), h("user", "乙"), h("assistant", "丙")], Mode::Discuss);
    assert_eq!(n, vec![h("user", "甲\n\n乙"), h("assistant", "丙")]);
}

#[test]
fn discuss_mode_uses_advisor_prompt_and_question_label() {
    let mut inp = input(None, "正文。", None, "这里节奏是不是太慢？");
    inp.mode = Mode::Discuss;
    let out = assemble(&inp);
    assert!(out.system.contains("写作顾问"));
    assert!(!out.system.contains("直接输出正文"));
    assert!(out.user.contains("【我的问题】\n这里节奏是不是太慢？"));
}

#[test]
fn cursor_aware_blocks_after_and_selection() {
    let after: String = "后".repeat(1500);
    let mut inp = input(None, "光标之前的正文。", None, INSTRUCTION);
    inp.cursor_aware = true;
    inp.cursor_after = Some(&after);
    inp.selection = Some("选中的一段。");
    let out = assemble(&inp);
    assert_eq!(
        slot_names(&out.log),
        vec!["System", "光标前文", "光标后文", "选中段落", "写作指令"]
    );
    assert!(out.user.starts_with("【光标前文（续写从这里接着写）】\n光标之前的正文。"));
    let after_body = out.user.split("【光标后文（新内容要能自然接上它）】\n").nth(1).unwrap().split("\n\n").next().unwrap();
    assert_eq!(after_body.chars().count(), AFTER_WINDOW_CHARS);
    assert!(out.user.contains("【选中段落】\n选中的一段。"));
}

#[test]
fn disabled_slots_are_skipped_but_logged() {
    let mut inp = input(Some("华丽辞藻。"), "当前正文。", Some("前情。"), INSTRUCTION);
    inp.injections = vec![injection("角色卡", "命中 1 人", "- 林远山", 0)];
    inp.disabled = vec!["文风".into(), "角色卡".into(), "当前章正文".into()];
    let out = assemble(&inp);
    assert!(!out.system.contains("【文风要求】"));
    assert!(!out.system.contains("【角色卡】"));
    assert!(out.system.contains("【上一章结尾】"));
    assert_eq!(out.user, INSTRUCTION, "正文块被关后 user 只剩指令");
    let disabled: Vec<&str> = out.log.slots.iter().filter(|s| s.disabled).map(|s| s.name.as_str()).collect();
    assert_eq!(disabled, vec!["文风", "角色卡", "当前章正文"]);
    let total: i64 = out.log.slots.iter().filter(|s| !s.disabled).map(|s| s.est_tokens).sum();
    assert_eq!(out.log.total_est_tokens, total, "总量只计实际注入");
}

#[test]
fn target_chars_appends_length_hint() {
    let mut inp = input(None, "", None, "写一段雪夜");
    inp.target_chars = Some(800);
    let out = assemble(&inp);
    assert_eq!(out.user, "写一段雪夜\n（本次输出约 800 字）");
    assert_eq!(out.log.slots.last().unwrap().chars, "写一段雪夜".chars().count() as i64, "日志记原始指令");
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
    // 注入不进 history（history 只放真实对话）
    assert!(out.history.is_empty());
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
