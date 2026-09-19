use crate::util::estimate_tokens;

/// 当前章正文的尾部注入窗口（字符数，中文按 char 不按 byte）。
pub const CHAPTER_WINDOW_CHARS: usize = 4000;
/// 上一章结尾的尾部注入窗口（字符数）。
pub const PREV_WINDOW_CHARS: usize = 1000;
/// 槽位预览的最大字符数（截断不加省略号，展示形式由前端决定）。
const PREVIEW_HEAD_CHARS: usize = 120;

/// 单个槽位的组装摘要（上下文预览面板逐槽展示）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct SlotLog {
    pub name: String,
    pub source: String,
    pub chars: i64,
    pub est_tokens: i64,
    pub preview_head: String,
}

/// 一次组装的完整日志：各槽摘要 + 总估算 token。
#[derive(Debug, Clone, serde::Serialize)]
pub struct AssemblyLog {
    pub slots: Vec<SlotLog>,
    pub total_est_tokens: i64,
}

/// 组装输入：各注入源由调用方（命令层）读取后传入，组装器保持纯函数。
#[derive(Debug, Clone)]
pub struct AssembleInput<'a> {
    pub book_title: &'a str,
    pub style_prompt: Option<&'a str>,      // 激活文风卡的 prompt_md
    pub chapter_text: &'a str,              // 当前章已写正文
    pub prev_chapter_tail: Option<&'a str>, // 上一章尾部
    pub instruction: &'a str,
}

/// 组装产物：system / history / user 与 llm::stream::StreamReq 同构，log 供预览面板。
#[derive(Debug, Clone)]
pub struct Assembled {
    pub system: String,
    pub history: Vec<(String, String)>, // (role, content)
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
    }
}

/// 固定槽位顺序组装：System → 文风（有才记）→ 上一章结尾（有才记）→
/// 当前章正文（非空才记）→ 写作指令；逐槽记录摘要与总估算 token。
pub fn assemble(input: &AssembleInput) -> Assembled {
    let default_prompt = format!(
        "你是长篇小说《{}》的合著者。续写须与既有正文风格、人称、时态保持一致，直接输出正文，不要解释。",
        input.book_title
    );
    let mut slots = vec![slot("System", "默认创作提示", &default_prompt)];

    let mut system = default_prompt.clone();
    if let Some(style) = input.style_prompt.filter(|s| !s.is_empty()) {
        system.push_str("\n\n【文风要求】\n");
        system.push_str(style);
        slots.push(slot("文风", "激活文风卡", style));
    }

    let mut history = Vec::new();
    if let Some(prev) = input.prev_chapter_tail.filter(|s| !s.is_empty()) {
        let tail = tail_window(prev, PREV_WINDOW_CHARS);
        slots.push(slot("上一章结尾", "上一章正文", &tail));
        history.push(("user".to_string(), format!("【上一章结尾】\n{tail}")));
    }

    let user = if input.chapter_text.is_empty() {
        input.instruction.to_string()
    } else {
        let tail = tail_window(input.chapter_text, CHAPTER_WINDOW_CHARS);
        slots.push(slot("当前章正文", "当前章节", &tail));
        format!("【当前章节已有正文（尾部）】\n{tail}\n\n【写作指令】\n{}", input.instruction)
    };
    slots.push(slot("写作指令", "用户输入", input.instruction));

    let total_est_tokens = slots.iter().map(|s| s.est_tokens).sum();
    Assembled {
        system,
        history,
        user,
        log: AssemblyLog { slots, total_est_tokens },
    }
}
