use crate::util::estimate_tokens;

/// 当前章正文（或光标前文）的尾部注入窗口（字符数，中文按 char 不按 byte）。
pub const CHAPTER_WINDOW_CHARS: usize = 4000;
/// 上一章结尾的尾部注入窗口（字符数）。
pub const PREV_WINDOW_CHARS: usize = 1000;
/// 光标后文的头部注入窗口：续写须能接上后文（字符数）。
pub const AFTER_WINDOW_CHARS: usize = 1000;
/// 选中段落上限（字符数）：改写/润色类命令的作用对象。
pub const SELECTION_MAX_CHARS: usize = 6000;
/// 对话历史预算（字符数 / 条数）：写正文模式只带最近一两轮，讨论模式带得更多。
pub const HISTORY_BUDGET_WRITE: usize = 4000;
pub const HISTORY_MAX_WRITE: usize = 4;
pub const HISTORY_BUDGET_DISCUSS: usize = 12000;
pub const HISTORY_MAX_DISCUSS: usize = 16;
/// 槽位预览的最大字符数（截断不加省略号，展示形式由前端决定）。
const PREVIEW_HEAD_CHARS: usize = 120;

/// 对话模式（阶段 2A）：写正文 = 直接产出可采纳的正文；讨论 = 自由对话（剧情/设定/建议）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Mode {
    #[default]
    Write,
    Discuss,
}

impl Mode {
    pub fn parse(s: Option<&str>) -> Mode {
        match s {
            Some("discuss") => Mode::Discuss,
            _ => Mode::Write,
        }
    }
    pub fn as_str(&self) -> &'static str {
        match self {
            Mode::Write => "write",
            Mode::Discuss => "discuss",
        }
    }
}

/// 单个槽位的组装摘要（上下文预览面板逐槽展示）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SlotLog {
    pub name: String,
    pub source: String,
    pub chars: i64,
    pub est_tokens: i64,
    pub preview_head: String,
    /// 本轮被用户关闭（未注入，仅在预览中列出以便重新打开）
    #[serde(default)]
    pub disabled: bool,
}

/// 一次组装的完整日志：各槽摘要 + 总估算 token（只计实际注入的槽位）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct AssemblyLog {
    pub slots: Vec<SlotLog>,
    pub total_est_tokens: i64,
}

/// 组装输入：各注入源由调用方（命令层）读取后传入，组装器保持纯函数。
#[derive(Debug, Clone, Default)]
pub struct AssembleInput<'a> {
    pub book_title: &'a str,
    pub style_prompt: Option<&'a str>,      // 激活文风卡的 prompt_md
    /// 当前章已写正文；有光标信息时为「光标前文」
    pub chapter_text: &'a str,
    pub prev_chapter_tail: Option<&'a str>, // 上一章尾部
    pub instruction: &'a str,
    /// 注入原子槽位（M7 批次6：角色卡/伏笔/情节块/灵感卡；阶段 2A：@ 引用资料）。
    /// 文本由命令层按每书配置渲染好；这里只做预算截断、拼进 system、记日志。
    pub injections: Vec<InjectionInput>,
    /// 阶段 2A：对话模式
    pub mode: Mode,
    /// 阶段 2A：前端传来光标位置时为 true（当前章槽位改叫「光标前文」）
    pub cursor_aware: bool,
    /// 光标之后的正文（续写须能接上）
    pub cursor_after: Option<&'a str>,
    /// 编辑器选中段落（改写/润色类命令的作用对象）
    pub selection: Option<&'a str>,
    /// 本会话此前的对话（时间序，(role, content)，只含用户原话与 AI 回答）
    pub history: Vec<(String, String)>,
    /// 本轮关闭的槽位名（上下文胶囊上点 ×）
    pub disabled: Vec<String>,
    /// 期望输出字数（长度预设）
    pub target_chars: Option<i64>,
}

/// 单个注入原子槽位：命令层渲染完成的整段文本 + 每书预算（0 = 不限）。
#[derive(Debug, Clone)]
pub struct InjectionInput {
    /// 槽位名（「角色卡」「伏笔提醒」「情节块」「灵感卡」「引用资料」）
    pub name: String,
    /// 来源摘要（预览面板展示，如「关键词命中 2 人」）
    pub source: String,
    pub text: String,
    pub budget: usize,
}

/// 组装产物：system / history / user 与 llm::stream::StreamReq 同构，log 供预览面板。
#[derive(Debug, Clone)]
pub struct Assembled {
    pub system: String,
    pub history: Vec<(String, String)>, // (role, content)：纯对话历史，已按预算裁剪、角色交替
    pub user: String,
    pub log: AssemblyLog,
}

/// 取文本尾部窗口：超窗则跳过前部，按字符计数。
fn tail_window(s: &str, window: usize) -> String {
    let total = s.chars().count();
    if total <= window {
        return s.to_string();
    }
    s.chars().skip(total - window).collect()
}

/// 取文本头部窗口：注入原子清单超预算时丢弃尾部条目（清单语义保头）。
fn head_window(s: &str, window: usize) -> String {
    if window == 0 || s.chars().count() <= window {
        return s.to_string();
    }
    s.chars().take(window).collect()
}

fn preview_head(s: &str) -> String {
    s.chars().take(PREVIEW_HEAD_CHARS).collect()
}

fn slot(name: &str, source: &str, payload: &str) -> SlotLog {
    SlotLog {
        name: name.to_string(),
        source: source.to_string(),
        chars: payload.chars().count() as i64,
        est_tokens: estimate_tokens(payload),
        preview_head: preview_head(payload),
        disabled: false,
    }
}

fn off_slot(name: &str, source: &str, payload: &str) -> SlotLog {
    SlotLog { disabled: true, ..slot(name, source, payload) }
}

/// 写正文模式的默认提示（保持 M1 原文：既有用户的续写行为不变）。
pub fn write_prompt(book_title: &str) -> String {
    format!("你是长篇小说《{book_title}》的合著者。续写须与既有正文风格、人称、时态保持一致，直接输出正文，不要解释。")
}

/// 讨论模式的默认提示：允许讨论、建议、举例，用 Markdown 组织。
pub fn discuss_prompt(book_title: &str) -> String {
    format!(
        "你是长篇小说《{book_title}》的写作顾问与合著者。可以讨论剧情走向、人物动机、设定与结构，给出具体、可直接采用的建议；需要示范时可写示例段落。回答用简洁的 Markdown 组织，不要空泛的套话。"
    )
}

/// 对话历史裁剪：从最近往前取，受条数与字数双预算约束（单条超预算保留尾部）；
/// 结果规整为 user 开头、角色交替（相邻同角色合并），保证各家 API 都接受。
pub fn trim_history(history: &[(String, String)], mode: Mode) -> Vec<(String, String)> {
    let (budget, max) = match mode {
        Mode::Write => (HISTORY_BUDGET_WRITE, HISTORY_MAX_WRITE),
        Mode::Discuss => (HISTORY_BUDGET_DISCUSS, HISTORY_MAX_DISCUSS),
    };
    let mut picked: Vec<(String, String)> = Vec::new();
    let mut total = 0usize;
    for (role, content) in history.iter().rev() {
        if content.trim().is_empty() {
            continue;
        }
        let n = content.chars().count();
        if picked.len() >= max || (!picked.is_empty() && total + n > budget) {
            break;
        }
        let kept = if n > budget { tail_window(content, budget) } else { content.clone() };
        total += kept.chars().count();
        picked.push((role.clone(), kept));
    }
    picked.reverse();
    // 规整：丢掉开头的 assistant；相邻同角色合并
    let mut out: Vec<(String, String)> = Vec::new();
    for (role, content) in picked {
        let role = if role == "assistant" { "assistant".to_string() } else { "user".to_string() };
        if out.is_empty() && role == "assistant" {
            continue;
        }
        if let Some(last) = out.last_mut() {
            if last.0 == role {
                last.1.push_str("\n\n");
                last.1.push_str(&content);
                continue;
            }
        }
        out.push((role, content));
    }
    out
}

/// 固定槽位顺序组装：System → 文风 → 注入原子（按传入序）→ 上一章结尾 → 对话历史 →
/// 当前章正文/光标前文 → 光标后文 → 选中段落 → 写作指令；逐槽记录摘要与总估算 token。
/// 本轮关闭的槽位不注入，但仍以 disabled 记入日志（预览里可重新打开）。
pub fn assemble(input: &AssembleInput) -> Assembled {
    let off = |name: &str| input.disabled.iter().any(|d| d == name);
    let default_prompt = match input.mode {
        Mode::Write => write_prompt(input.book_title),
        Mode::Discuss => discuss_prompt(input.book_title),
    };
    let mut slots = vec![slot("System", "默认创作提示", &default_prompt)];
    let mut system = default_prompt.clone();

    if let Some(style) = input.style_prompt.filter(|s| !s.is_empty()) {
        if off("文风") {
            slots.push(off_slot("文风", "激活文风卡", style));
        } else {
            system.push_str("\n\n【文风要求】\n");
            system.push_str(style);
            slots.push(slot("文风", "激活文风卡", style));
        }
    }

    // 注入原子（M7 批次6）：预算截断保头（清单丢尾），逐槽独立记日志
    for inj in &input.injections {
        if inj.text.is_empty() {
            continue;
        }
        let kept = head_window(&inj.text, inj.budget);
        if off(&inj.name) {
            slots.push(off_slot(&inj.name, &inj.source, &kept));
            continue;
        }
        system.push_str(&format!("\n\n【{}】\n{}", inj.name, kept));
        slots.push(slot(&inj.name, &inj.source, &kept));
    }

    // 上一章结尾：作为前情放进 system（历史只留真实对话，角色才能严格交替）
    if let Some(prev) = input.prev_chapter_tail.filter(|s| !s.is_empty()) {
        let tail = tail_window(prev, PREV_WINDOW_CHARS);
        if off("上一章结尾") {
            slots.push(off_slot("上一章结尾", "上一章正文", &tail));
        } else {
            system.push_str(&format!("\n\n【上一章结尾】\n{tail}"));
            slots.push(slot("上一章结尾", "上一章正文", &tail));
        }
    }

    // 对话历史（阶段 2A 多轮）：按模式预算裁剪
    let mut history = Vec::new();
    if !input.history.is_empty() {
        let trimmed = trim_history(&input.history, input.mode);
        if !trimmed.is_empty() {
            let joined: String = trimmed.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>().join("\n");
            let source = format!("最近 {} 条", trimmed.len());
            if off("对话历史") {
                slots.push(off_slot("对话历史", &source, &joined));
            } else {
                slots.push(slot("对话历史", &source, &joined));
                history = trimmed;
            }
        }
    }

    // user：正文上下文块 + 指令
    let mut blocks: Vec<String> = Vec::new();
    let chapter_slot = if input.cursor_aware { "光标前文" } else { "当前章正文" };
    if !input.chapter_text.is_empty() {
        let tail = tail_window(input.chapter_text, CHAPTER_WINDOW_CHARS);
        if off(chapter_slot) {
            slots.push(off_slot(chapter_slot, "当前章节", &tail));
        } else {
            let label = if input.cursor_aware { "【光标前文（续写从这里接着写）】" } else { "【当前章节已有正文（尾部）】" };
            blocks.push(format!("{label}\n{tail}"));
            slots.push(slot(chapter_slot, "当前章节", &tail));
        }
    }
    if let Some(after) = input.cursor_after.filter(|s| !s.trim().is_empty()) {
        let head = head_window(after, AFTER_WINDOW_CHARS);
        if off("光标后文") {
            slots.push(off_slot("光标后文", "当前章节", &head));
        } else {
            blocks.push(format!("【光标后文（新内容要能自然接上它）】\n{head}"));
            slots.push(slot("光标后文", "当前章节", &head));
        }
    }
    if let Some(sel) = input.selection.filter(|s| !s.trim().is_empty()) {
        let kept = head_window(sel, SELECTION_MAX_CHARS);
        if off("选中段落") {
            slots.push(off_slot("选中段落", "编辑器选区", &kept));
        } else {
            blocks.push(format!("【选中段落】\n{kept}"));
            slots.push(slot("选中段落", "编辑器选区", &kept));
        }
    }

    let mut instruction = input.instruction.to_string();
    if let Some(n) = input.target_chars.filter(|n| *n > 0) {
        match input.mode {
            Mode::Write => instruction.push_str(&format!("\n（本次输出约 {n} 字）")),
            Mode::Discuss => instruction.push_str(&format!("\n（回答控制在约 {n} 字）")),
        }
    }
    let user = if blocks.is_empty() {
        instruction.clone()
    } else {
        let label = match input.mode {
            Mode::Write => "【写作指令】",
            Mode::Discuss => "【我的问题】",
        };
        format!("{}\n\n{label}\n{instruction}", blocks.join("\n\n"))
    };
    slots.push(slot("写作指令", "用户输入", input.instruction));

    let total_est_tokens = slots.iter().filter(|s| !s.disabled).map(|s| s.est_tokens).sum();
    Assembled {
        system,
        history,
        user,
        log: AssemblyLog { slots, total_est_tokens },
    }
}
