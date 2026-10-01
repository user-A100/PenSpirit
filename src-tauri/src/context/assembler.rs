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
    /// 阶段 2B：超出上下文预算被裁掉（未注入）
    #[serde(default)]
    pub trimmed: bool,
    /// 阶段 2B：为何被包含（预览面板展示，排查「它为什么提到了 X」）
    #[serde(default)]
    pub reason: String,
}

/// 一次组装的完整日志：各槽摘要 + 总估算 token（只计实际注入的槽位）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct AssemblyLog {
    pub slots: Vec<SlotLog>,
    pub total_est_tokens: i64,
    /// 阶段 2B：本次使用的预算（0 = 不限），前端画预算条
    #[serde(default)]
    pub budget_tokens: i64,
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
    /// 阶段 2B：常驻记忆（本书 + 所在卷），放进 system
    pub memory: Option<&'a str>,
    pub memory_reason: Option<&'a str>,
    /// 阶段 2B：写作规则（已按作用域筛好、渲染成一个槽位）
    pub rules: Option<InjectionInput>,
    /// 阶段 2B：本章作者注——放在写作指令之前（近端强约束）
    pub author_note: Option<&'a str>,
    /// 阶段 2B：上一章标题（「为何被包含」用）
    pub prev_title: Option<&'a str>,
    /// 阶段 2B：上下文预算（估算 token）；None / 0 = 不限
    pub budget_tokens: Option<i64>,
    /// 阶段 2B：重试选项追加在指令后（更长 / 更短 / 换写法…）
    pub retry_hint: Option<&'a str>,
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
    /// 阶段 2B：为何被包含（如「正文提到：南宫婉、晚儿→林晚」）
    pub reason: String,
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
        trimmed: false,
        reason: String::new(),
    }
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

/// 超预算时的裁剪顺序（先裁前面的）：清单类注入 → 历史 → 提醒 → 前情 → 后文 → 主动引用；
/// System / 文风 / 常驻记忆 / 写作规则 / 选中段落 / 作者注 / 写作指令永不裁；当前章正文最后缩窗。
pub const TRIM_ORDER: [&str; 8] = ["灵感卡", "情节块", "对话历史", "伏笔提醒", "角色卡", "上一章结尾", "光标后文", "引用资料"];
/// 缩窗后当前章正文至少保留的字数
const MIN_CHAPTER_CHARS: usize = 500;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Place {
    /// 拼进 system：`\n\n【header】\n正文`
    System,
    /// 对话历史（独立消息）
    History,
    /// user 消息里的上下文块（label 行 + 正文）
    User,
}

struct Part {
    name: String,
    source: String,
    reason: String,
    /// 记日志 / 估 token 的载荷
    payload: String,
    place: Place,
    /// System：【header】；User：标签行
    header: String,
    off: bool,
    trimmed: bool,
}

impl Part {
    fn new(name: &str, source: &str, reason: &str, payload: String, place: Place, header: &str, off: bool) -> Self {
        Part {
            name: name.into(),
            source: source.into(),
            reason: reason.into(),
            payload,
            place,
            header: header.into(),
            off,
            trimmed: false,
        }
    }
    fn tokens(&self) -> i64 {
        estimate_tokens(&self.payload)
    }
    fn log(&self) -> SlotLog {
        SlotLog {
            disabled: self.off,
            trimmed: self.trimmed,
            reason: self.reason.clone(),
            ..slot(&self.name, &self.source, &self.payload)
        }
    }
}

/// 固定槽位顺序组装：System → 文风 → 常驻记忆 → 写作规则 → 注入原子（按传入序）→ 上一章结尾 → 对话历史 →
/// 当前章正文/光标前文 → 光标后文 → 选中段落 → 作者注 → 写作指令；逐槽记录摘要、来由与总估算 token。
/// 本轮关闭的槽位不注入，但仍以 disabled 记入日志（预览里可重新打开）。
/// 阶段 2B：给了预算且超出时，按 TRIM_ORDER 逐个裁掉（trimmed 记入日志），仍超则把当前章正文缩窗。
pub fn assemble(input: &AssembleInput) -> Assembled {
    let off = |name: &str| input.disabled.iter().any(|d| d == name);
    let default_prompt = match input.mode {
        Mode::Write => write_prompt(input.book_title),
        Mode::Discuss => discuss_prompt(input.book_title),
    };
    let mode_reason = match input.mode {
        Mode::Write => "固定：写正文模式的创作提示",
        Mode::Discuss => "固定：讨论模式的顾问提示",
    };
    let mut parts: Vec<Part> = vec![Part::new("System", "默认创作提示", mode_reason, default_prompt.clone(), Place::System, "", false)];

    if let Some(style) = input.style_prompt.filter(|s| !s.is_empty()) {
        parts.push(Part::new("文风", "激活文风卡", "本书当前激活的文风卡", style.to_string(), Place::System, "文风要求", off("文风")));
    }
    if let Some(mem) = input.memory.filter(|s| !s.trim().is_empty()) {
        let reason = input.memory_reason.unwrap_or("本书常驻记忆");
        parts.push(Part::new("常驻记忆", "记忆", reason, mem.to_string(), Place::System, "常驻记忆", off("常驻记忆")));
    }
    if let Some(rules) = input.rules.as_ref().filter(|r| !r.text.is_empty()) {
        parts.push(Part::new(&rules.name, &rules.source, &rules.reason, rules.text.clone(), Place::System, &rules.name, off(&rules.name)));
    }
    // 注入原子（M7 批次6）：预算截断保头（清单丢尾），逐槽独立记日志
    for inj in &input.injections {
        if inj.text.is_empty() {
            continue;
        }
        let kept = head_window(&inj.text, inj.budget);
        parts.push(Part::new(&inj.name, &inj.source, &inj.reason, kept, Place::System, &inj.name, off(&inj.name)));
    }
    // 上一章结尾：作为前情放进 system（历史只留真实对话，角色才能严格交替）
    if let Some(prev) = input.prev_chapter_tail.filter(|s| !s.is_empty()) {
        let tail = tail_window(prev, PREV_WINDOW_CHARS);
        let reason = match input.prev_title {
            Some(t) => format!("全书序前一章《{t}》的结尾 {PREV_WINDOW_CHARS} 字（跨卷亦然）"),
            None => format!("全书序前一章的结尾 {PREV_WINDOW_CHARS} 字"),
        };
        parts.push(Part::new("上一章结尾", "上一章正文", &reason, tail, Place::System, "上一章结尾", off("上一章结尾")));
    }
    // 对话历史（阶段 2A 多轮）：按模式预算裁剪
    let trimmed_history = if input.history.is_empty() { Vec::new() } else { trim_history(&input.history, input.mode) };
    if !trimmed_history.is_empty() {
        let joined: String = trimmed_history.iter().map(|(_, c)| c.as_str()).collect::<Vec<_>>().join("\n");
        let source = format!("最近 {} 条", trimmed_history.len());
        let (budget, max) = match input.mode {
            Mode::Write => (HISTORY_BUDGET_WRITE, HISTORY_MAX_WRITE),
            Mode::Discuss => (HISTORY_BUDGET_DISCUSS, HISTORY_MAX_DISCUSS),
        };
        let reason = format!("本会话最近的对话（本模式最多 {max} 条 / {budget} 字）");
        parts.push(Part::new("对话历史", &source, &reason, joined, Place::History, "", off("对话历史")));
    }
    // user：正文上下文块 + 指令
    let chapter_slot = if input.cursor_aware { "光标前文" } else { "当前章正文" };
    if !input.chapter_text.is_empty() {
        let tail = tail_window(input.chapter_text, CHAPTER_WINDOW_CHARS);
        let label = if input.cursor_aware { "【光标前文（续写从这里接着写）】" } else { "【当前章节已有正文（尾部）】" };
        let reason = if input.cursor_aware {
            format!("编辑器光标之前的正文（尾部 {CHAPTER_WINDOW_CHARS} 字）")
        } else {
            format!("当前章已写正文（尾部 {CHAPTER_WINDOW_CHARS} 字）")
        };
        parts.push(Part::new(chapter_slot, "当前章节", &reason, tail, Place::User, label, off(chapter_slot)));
    }
    if let Some(after) = input.cursor_after.filter(|s| !s.trim().is_empty()) {
        let head = head_window(after, AFTER_WINDOW_CHARS);
        let reason = format!("光标之后的正文（头部 {AFTER_WINDOW_CHARS} 字），让新内容接得上");
        parts.push(Part::new("光标后文", "当前章节", &reason, head, Place::User, "【光标后文（新内容要能自然接上它）】", off("光标后文")));
    }
    if let Some(sel) = input.selection.filter(|s| !s.trim().is_empty()) {
        let kept = head_window(sel, SELECTION_MAX_CHARS);
        parts.push(Part::new("选中段落", "编辑器选区", "编辑器里选中的段落（改写 / 润色的对象）", kept, Place::User, "【选中段落】", off("选中段落")));
    }
    if let Some(note) = input.author_note.filter(|s| !s.trim().is_empty()) {
        parts.push(Part::new(
            "作者注",
            "本章作者注",
            "本章作者注：放在指令之前，作近端强约束",
            note.to_string(),
            Place::User,
            "【作者注（本章要求，务必遵守）】",
            off("作者注"),
        ));
    }

    // 预算裁剪（阶段 2B）
    let instruction_tokens = estimate_tokens(input.instruction);
    let live = |ps: &[Part]| ps.iter().filter(|p| !p.off && !p.trimmed).map(|p| p.tokens()).sum::<i64>() + instruction_tokens;
    if let Some(budget) = input.budget_tokens.filter(|b| *b > 0) {
        for name in TRIM_ORDER {
            if live(&parts) <= budget {
                break;
            }
            if let Some(p) = parts.iter_mut().find(|p| p.name == name && !p.off && !p.trimmed) {
                p.trimmed = true;
                p.reason = format!("{}——超出上下文预算 {budget}，本轮未发送", p.reason);
            }
        }
        let over = live(&parts) - budget;
        if over > 0 {
            if let Some(p) = parts.iter_mut().find(|p| p.name == chapter_slot && !p.off) {
                let chars = p.payload.chars().count();
                let tokens = p.tokens().max(1);
                let keep_tokens = (tokens - over).max(0);
                let keep = ((chars as i64 * keep_tokens / tokens) as usize).max(MIN_CHAPTER_CHARS).min(chars);
                if keep < chars {
                    p.payload = tail_window(&p.payload, keep);
                    p.reason = format!("{}——超预算缩窗至最后 {keep} 字", p.reason);
                }
            }
        }
    }

    // 渲染
    let mut system = String::new();
    let mut history = Vec::new();
    let mut blocks: Vec<String> = Vec::new();
    for p in parts.iter().filter(|p| !p.off && !p.trimmed) {
        match p.place {
            Place::System if p.name == "System" => system.push_str(&p.payload),
            Place::System => system.push_str(&format!("\n\n【{}】\n{}", p.header, p.payload)),
            Place::History => history = trimmed_history.clone(),
            Place::User => blocks.push(format!("{}\n{}", p.header, p.payload)),
        }
    }
    let mut instruction = input.instruction.to_string();
    if let Some(hint) = input.retry_hint.filter(|h| !h.trim().is_empty()) {
        instruction.push_str(&format!("\n（{hint}）"));
    }
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

    let mut slots: Vec<SlotLog> = parts.iter().map(Part::log).collect();
    slots.push(SlotLog { reason: "你的输入".into(), ..slot("写作指令", "用户输入", input.instruction) });
    let total_est_tokens = slots.iter().filter(|s| !s.disabled && !s.trimmed).map(|s| s.est_tokens).sum();
    Assembled {
        system,
        history,
        user,
        log: AssemblyLog { slots, total_est_tokens, budget_tokens: input.budget_tokens.unwrap_or(0) },
    }
}
