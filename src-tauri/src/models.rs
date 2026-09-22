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
    /// 完本目标字数（None = 未设置，M3）
    #[serde(default)]
    pub target_words: Option<i64>,
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
    /// 大纲梗概（独立于正文的展示字段，卡片墙/大纲列用，导出不带）
    #[serde(default)]
    pub synopsis: String,
    /// 彩色标签（书内定义，单选；None = 未打标）
    #[serde(default)]
    pub label_id: Option<i64>,
    /// 写作状态（书内定义，单选；None = 未设置）
    #[serde(default)]
    pub status_id: Option<i64>,
    /// 本章目标字数（None = 未设置）
    #[serde(default)]
    pub target_words: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterContent {
    pub meta: ChapterMeta,
    pub content: String,
}

/// 章节元数据部分更新：字段缺失 = 不动；字段为 null = 清空。
/// Option<Option<T>> 序列化约定——外层 None（缺省）跳过，Some(None)（JSON null）清空。
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ChapterMetaUpdate {
    #[serde(default)]
    pub synopsis: Option<String>,
    #[serde(default)]
    pub label_id: Option<Option<i64>>,
    #[serde(default)]
    pub status_id: Option<Option<i64>>,
    #[serde(default)]
    pub target_words: Option<Option<i64>>,
}

/// 彩色标签定义（书内；章单选引用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub color: String,
    pub sort_key: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LabelInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub title: String,
    pub color: String,
}

/// 写作状态定义（书内；章单选引用；无颜色）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Status {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub sort_key: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct StatusInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub title: String,
}

/// 关键词（书内去重；章多对多引用）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Keyword {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub color: String,
    pub created_at: String,
}

/// 章节模板：is_default 者在建新章时自动作为初始正文
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChapterTemplate {
    pub id: i64,
    pub book_id: i64,
    pub name: String,
    pub content: String,
    pub is_default: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ChapterTemplateInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub name: String,
    pub content: String,
    pub is_default: bool,
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

// ---------- M3-T1 伏笔与按日统计 ----------

/// 伏笔登记（foreshadows 表；planted/target 章的序号由前端按章节列表序解析，
/// 章软删后引用仍保留——前端以 -1 特判显示「章已删」）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Foreshadow {
    pub id: i64,
    pub book_id: i64,
    pub title: String,
    pub planted_chapter_id: i64,
    /// 计划回收章（None = 未定）
    pub target_chapter_id: Option<i64>,
    /// active | resolved | dropped
    pub status: String,
    pub note: String,
    pub created_at: String,
    /// 实际回收章（仅 resolved 时有值）
    pub resolved_chapter_id: Option<i64>,
    /// 放行理由（M4 T5 还债登记：登记还债章时填写）
    #[serde(default)]
    pub override_note: String,
    /// 登记的还债章（M4 T5：紧急度倒计时改按它算；None = 未登记）
    #[serde(default)]
    pub repay_chapter_id: Option<i64>,
}

/// 伏笔登记入参：id=None 插入，Some 更新（book_id 以首次登记为准，更新不改属主）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeshadowInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub title: String,
    pub planted_chapter_id: i64,
    pub target_chapter_id: Option<i64>,
    pub note: String,
    #[serde(default)]
    pub override_note: String,
    #[serde(default)]
    pub repay_chapter_id: Option<i64>,
}

// ---------- M4 人物卡 ----------

/// 人物卡（characters 表）。图谱化（关系/出场章节）在此之上迭代。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Character {
    pub id: i64,
    pub book_id: i64,
    pub name: String,
    pub role: String,
    /// 逗号分隔别名（检索/图谱消歧用）
    pub aliases: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 人物卡入参：id=None 插入，Some 更新（book_id 不改属主）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub name: String,
    pub role: String,
    pub aliases: String,
    pub description: String,
}

/// 角色关系（character_relations 表）：source→target 单向一行；对称类型
/// （配偶/兄弟/挚友…）由前端视为无向边，查询 source OR target。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterRelation {
    pub id: i64,
    pub book_id: i64,
    pub source_id: i64,
    pub target_id: i64,
    /// 自由文本；预设：父母/子女/配偶/兄弟/师徒/仇敌/挚友
    pub relation_type: String,
    pub note: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 关系入参：id=None 插入（重复 source+target+type 静默转更新 note），Some 更新。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterRelationInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub source_id: i64,
    pub target_id: i64,
    pub relation_type: String,
    pub note: String,
}

// ---------- M5 图谱：世界地图 ----------

/// 世界地图（maps 表）：图片存 $APPDATA/maps/，DB 只存路径，
/// 前端经 asset 协议（convertFileSrc）渲染。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Map {
    pub id: i64,
    pub book_id: i64,
    pub name: String,
    pub path: String,
    pub created_at: String,
    pub updated_at: String,
}

/// 地点（places 表）：pin 坐标为图面百分比 0~100，换图/缩放不失效。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Place {
    pub id: i64,
    pub book_id: i64,
    pub map_id: i64,
    pub name: String,
    pub description: String,
    /// 逗号分隔 character id
    pub linked_character_ids: String,
    pub x: f64,
    pub y: f64,
    pub created_at: String,
    pub updated_at: String,
}

/// 地点入参：id=None 插入、Some 更新；book_id 由 map 行派生（比计划更严：杜绝跨书脏数据）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaceInput {
    pub id: Option<i64>,
    pub map_id: i64,
    pub name: String,
    pub description: String,
    pub linked_character_ids: String,
    pub x: f64,
    pub y: f64,
}

// ---------- M4 大纲体系 ----------

/// 大纲条目（outlines 表）。三级：master=总纲（每书一篇）、
/// volume=卷纲（手动分卷）、chapter=章细纲（chapter_id 关联，每章一篇）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Outline {
    pub id: i64,
    pub book_id: i64,
    pub kind: String,
    pub chapter_id: Option<i64>,
    pub title: String,
    pub content: String,
    pub sort_key: i64,
    pub created_at: String,
    pub updated_at: String,
}

/// 大纲入参：id=None 插入，Some 更新。kind 合法性与唯一性（每书一篇总纲、
/// 每章一篇细纲）由 repo 层校验；volume 的卷名入 title。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutlineInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub kind: String,
    pub chapter_id: Option<i64>,
    pub title: String,
    pub content: String,
    pub sort_key: i64,
}

// ---------- M4 素材库 / 情节块 ----------

/// 素材（materials 表，全局不分书）。素材是作者资产：地名/门派/道具/金句/桥段，跨书复用。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Material {
    pub id: i64,
    pub title: String,
    pub category: String,
    pub content: String,
    pub tags: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaterialInput {
    pub id: Option<i64>,
    pub title: String,
    pub category: String,
    pub content: String,
    pub tags: String,
}

/// 情节块（plot_blocks 表，按书）。叙事草稿材料：一句话场景/事件，
/// status 三态（idea=点子 → ready=可写 → used=已用），chapter_id 记录用在哪章。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotBlock {
    pub id: i64,
    pub book_id: i64,
    pub content: String,
    pub status: String,
    pub chapter_id: Option<i64>,
    pub sort_key: i64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlotBlockInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub content: String,
    pub status: String,
    pub chapter_id: Option<i64>,
    pub sort_key: i64,
}

/// 按日聚合统计（stats_range；书维度已 SUM 掉）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DailyStat {
    pub date: String,
    pub words: i64,
    pub active_minutes: i64,
}

/// 阅读背景图（M3-T6）。文件存 {appData}/background/{id}-{name}.{ext}，
/// 纯文件资源不进 db；id = 导入时刻纳秒时间戳 hex，name 为原文件名（净化后）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BgImage {
    pub id: String,
    /// 入库文件绝对路径（前端 convertFileSrc 转 asset 协议）
    pub path: String,
    pub name: String,
}

/// wiki 出链（M7 批次3，按需扫描派生不落库）：`[[target]]` → 同书章题精确匹配消解。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiLink {
    pub from_id: i64,
    pub from_title: String,
    pub target: String,
    pub to_id: Option<i64>,
    pub to_title: Option<String>,
    pub snippet: String,
}

/// 反向链接：哪些章链到本章（自引除外）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Backlink {
    pub from_id: i64,
    pub from_title: String,
    pub snippet: String,
}

/// 人物提及计数：姓名与别名同权，逐章聚合；零提及不返回
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CharacterMention {
    pub character_id: i64,
    pub name: String,
    pub chapter_id: i64,
    pub chapter_title: String,
    pub count: i64,
}

/// 集合（M7 批次4，Scrivener Collections）：manual 手动勾章（引用不拷贝）、
/// saved 存为搜索（只存 query，结果打开时实时算）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: i64,
    pub book_id: i64,
    pub name: String,
    pub kind: String,
    pub query: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub name: String,
    pub kind: String,
    pub query: String,
}

// ---------- M7 批次6 注入原子配置 ----------

/// 单个注入槽位的每书配置（settings JSON `context:book:{id}`）。
/// budget=0 表示不限；ids=None 表示全部（伏笔=全部未回收；情节块/灵感=全部），
/// Some=只注入勾选项；all 仅角色卡用（true=不看关键词命中，全量注入）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlotConfig {
    pub enabled: bool,
    pub budget: i64,
    #[serde(default)]
    pub ids: Option<Vec<i64>>,
    #[serde(default)]
    pub all: bool,
}

/// 四个注入槽位的每书配置。settings 缺 key 时取 `default_context_config`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextConfig {
    pub characters: SlotConfig,
    pub foreshadows: SlotConfig,
    pub plots: SlotConfig,
    pub ideas: SlotConfig,
}

/// 默认配置：角色卡/伏笔自动触发开，情节块/灵感手动语义默认关。
pub fn default_context_config() -> ContextConfig {
    let slot = |enabled: bool, budget: i64| SlotConfig {
        enabled,
        budget,
        ids: None,
        all: false,
    };
    ContextConfig {
        characters: slot(true, 1500),
        foreshadows: slot(true, 800),
        plots: slot(false, 1000),
        ideas: slot(false, 600),
    }
}

// ---------- M7 批次7：自定义元数据字段 / 自由卡片墙 ----------

/// 自定义字段定义（custom_field_defs 表）：书级定义，章节值存 chapters.custom_meta。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomFieldDef {
    pub id: i64,
    pub book_id: i64,
    pub name: String,
    /// text | checkbox | list | date
    pub field_type: String,
    /// list 型的候选，JSON 字符串数组（如 ["红","蓝"]）
    pub list_options: String,
    pub sort_key: i64,
    pub created_at: String,
}

/// 自定义字段入参：id=None 插入，Some 更新。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomFieldDefInput {
    pub id: Option<i64>,
    pub book_id: i64,
    pub name: String,
    pub field_type: String,
    #[serde(default)]
    pub list_options: String,
    #[serde(default)]
    pub sort_key: i64,
}

/// 自由卡片墙单章摆位（chapters.freeform_x/y）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FreeformPos {
    pub chapter_id: i64,
    pub x: f64,
    pub y: f64,
}
