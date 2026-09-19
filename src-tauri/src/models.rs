use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Book {
    pub id: i64,
    pub slug: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    /// 软删时间（None = 未删除；Some 时 slug 指向 .trash_books/ 内位置）
    #[serde(default)]
    pub deleted_at: Option<String>,
    /// 软删前的原目录名（恢复时移回 root/{orig_dir_name}）
    #[serde(default)]
    pub orig_dir_name: Option<String>,
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
    /// 软删时间（None = 未删除；Some 时 file_path 指向 {book}/.trash/ 内位置）
    #[serde(default)]
    pub deleted_at: Option<String>,
    /// 软删前的原相对路径（恢复时移回）
    #[serde(default)]
    pub orig_file_path: Option<String>,
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
    /// 会话后端来源：'provider'（M1 HTTP 直连）或 'agent:{id}'（ACP agent）
    #[serde(default = "default_session_source")]
    pub source: String,
}

fn default_session_source() -> String {
    "provider".into()
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

// ---------- M2-T4 ACP 事件 payload（emit 到前端） ----------

/// `agent://stream`：流式增量（经 StreamCoalescer 合并）。
#[derive(Debug, Clone, Serialize)]
pub struct AcpStreamEvent {
    pub session_id: i64,
    pub text: String,
}

/// 权限选项（agent://permission 事件内）。
#[derive(Debug, Clone, Serialize)]
pub struct PermOption {
    pub option_id: String,
    pub name: String,
    /// allow_once | allow_always | reject_once | reject_always
    pub kind: String,
}

/// `agent://permission`：agent 请求工具授权，前端必须应答
/// （agents_respond_permission 传回 option_id；超时自动拒绝）。
#[derive(Debug, Clone, Serialize)]
pub struct AcpPermissionEvent {
    pub session_id: i64,
    pub request_id: String,
    pub title: String,
    pub options: Vec<PermOption>,
}

/// `agent://turn`：一回合结束（done 或 error）。content 非空时已落库。
#[derive(Debug, Clone, Serialize)]
pub struct AcpTurnEvent {
    pub session_id: i64,
    pub ok: bool,
    pub content: Option<String>,
    pub error: Option<String>,
}

/// 碰碰车词库条目（M2-T10）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BumpWord {
    pub id: i64,
    pub word: String,
    pub created_at: String,
}

/// 灵感卡（M2-T10；M5 素材系统直接复用）。
/// `words_json` / `tags_json` 是 JSON 数组字符串，落库前由 bump.rs 规范化。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Idea {
    pub id: i64,
    /// 备注（可为空）
    pub content: String,
    pub words_json: String,
    pub tags_json: String,
    pub created_at: String,
}
