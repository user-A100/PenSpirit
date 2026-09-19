use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterMeta {
    pub id: i64,
    pub book_id: i64,
    pub file_path: String,
    pub title: String,
    pub sort_key: f64,
    pub word_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContent {
    pub meta: ChapterMeta,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderProfile {
    pub id: i64,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
    pub max_tokens: i64,
    pub temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatSession {
    pub id: i64,
    pub book_id: i64,
    pub chapter_id: i64,
    pub title: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub id: i64,
    pub session_id: i64,
    pub role: String, // user|assistant|system
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleCard {
    pub id: i64,
    pub name: String,
    pub prompt_md: String,
    pub sample_md: String,
    pub tags: String, // JSON数组字符串
    pub created_at: String,
    pub updated_at: String,
}

/// ACP agent 描述（agents.json 的条目）。
/// id 形如 "claude" | "codex" | "gemini" | "custom:xxx"。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AgentDescriptor {
    pub id: String,
    pub name: String,
    /// 可执行命令名（或绝对路径），如 "claude-agent-acp"
    pub command: String,
    /// 命令参数，如 gemini: ["--acp", "--skip-trust"]
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub is_default: bool,
    /// 最近一次短连接探测结果（None = 未探测）
    #[serde(default)]
    pub last_probe: Option<ProbeResult>,
}

/// 一次性短连接探测结果。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProbeResult {
    pub ok: bool,
    /// agent_info.name
    pub agent_name: Option<String>,
    /// 协议版本（如 "v1"）
    pub protocol_version: Option<String>,
    /// session capabilities 是否支持 resume
    pub can_resume: bool,
    /// 失败原因（ok=false 时给出；成功时为 None）
    pub detail: Option<String>,
}
