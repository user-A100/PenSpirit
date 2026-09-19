# 笔仙 M1 AI 写作主体 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 笔仙获得 AI 能力：OpenAI 兼容 Provider 配置、流式续写会话（仿 cc-gui 消息流）、ContextAssembler 上下文组装（文风卡+前文滑窗+指令）、文风库（含 Claude skill md 导入）、上下文预览面板（组装日志）。

**Architecture:** Rust 侧新增 `llm/`（provider 调用+流式解析）、`context/`（组装器）、`repo/` 扩展（settings/sessions/messages/styles）；流式经 Tauri `emit("stream://{session_id}")` 推前端；前端新增设置模态、AI Dock（消息流+输入+预览）、文风库面板。M1 明文存储 api_key（规格书 §F1 已声明，keyring 为 Backlog）。

**Tech Stack:** async-openai 0.x（流式）、tauri Emitter/Listen、lucide-react（已装）。测试：纯函数 TDD（SSE 解析、组装器、token 估算）+ 既有测试回归；LLM 网络路径用 `#[ignore]` 活体测试（需环境变量）。

**Spec:** `docs/specs/2026-09-19-bixian-spec.md` §4.2（前瞻 schema）、§4.4（注入原子）、§5 F1。执行前必读。

## Global Constraints

- 沿用 M0 全部约束：Tauri 2.x 稳定版、返回结构体 snake_case、命令参数 JS camelCase、文案中文、每任务三件套（cargo test / pnpm test / pnpm build）全绿才提交、commit 规范、只引入列出依赖
- 流式事件统一信封：`#[serde(tag = "type", rename_all = "snake_case")] enum StreamEvent { Delta { text: String }, Done { session_id: i64, content: String }, Error { message: String } }`
- api_key 明文存 SQLite settings 表（单机可接受）；任何日志/错误信息不得输出 api_key
- LLM 调用一律 temperature 取自 provider 档案；请求失败不 panic，转 `StreamEvent::Error`
- 前端新增组件放 `src/components/{settings,chat,styles}/`

---

### Task M1-T1: 迁移 0002 与四个新仓库（settings/sessions/messages/styles）

**Files:**
- Create: `src-tauri/migrations/0002_m1.sql`、`src-tauri/src/repo/settings.rs`、`src-tauri/src/repo/sessions.rs`、`src-tauri/src/repo/styles.rs`、`src-tauri/tests/m1_repo_test.rs`
- Modify: `src-tauri/src/db.rs`（注册第二个迁移）、`src-tauri/src/models.rs`（新增模型）、`src-tauri/src/repo/mod.rs`、`src-tauri/src/lib.rs`

**Interfaces:**
- Produces:

```rust
// models.rs 新增
pub struct ProviderProfile { pub id: i64, pub name: String, pub base_url: String, pub api_key: String, pub model: String, pub max_tokens: i64, pub temperature: f64 }
pub struct ChatSession { pub id: i64, pub book_id: i64, pub chapter_id: i64, pub title: String, pub created_at: String }
pub struct ChatMessage { pub id: i64, pub session_id: i64, pub role: String, pub content: String, pub created_at: String } // role: user|assistant|system
pub struct StyleCard { pub id: i64, pub name: String, pub prompt_md: String, pub sample_md: String, pub tags: String /*JSON数组字符串*/, pub created_at: String, pub updated_at: String }

// repo/settings.rs —— settings 为 KV 表，provider 列表整体存一个 JSON key
pub fn get(conn: &Connection, key: &str) -> AppResult<Option<String>>;
pub fn set(conn: &Connection, key: &str, value: &str) -> AppResult<()>;   // upsert
pub fn providers(conn: &Connection) -> AppResult<Vec<ProviderProfile>>;   // 解析 key="providers"
pub fn save_provider(conn: &Connection, p: &ProviderProfile) -> AppResult<ProviderProfile>; // id=0 即新增，否则更新
pub fn delete_provider(conn: &Connection, id: i64) -> AppResult<()>;
pub fn active_provider_id(conn: &Connection) -> AppResult<Option<i64>>;   // key="active_provider"
pub fn set_active_provider(conn: &Connection, id: i64) -> AppResult<()>;
pub fn active_style_id(conn: &Connection, book_id: i64) -> AppResult<Option<i64>>; // key="style:book:{id}"
pub fn set_active_style(conn: &Connection, book_id: i64, style_id: i64) -> AppResult<()>;

// repo/sessions.rs
pub fn list_by_chapter(conn: &Connection, chapter_id: i64) -> AppResult<Vec<ChatSession>>;
pub fn get_or_create(conn: &Connection, chapter_id: i64, book_id: i64, title: &str) -> AppResult<ChatSession>; // 该章唯一，无则建
pub fn delete(conn: &Connection, id: i64) -> AppResult<()>;               // 级联删 messages
// messages
pub fn list_messages(conn: &Connection, session_id: i64) -> AppResult<Vec<ChatMessage>>; // ORDER BY id
pub fn append_message(conn: &Connection, session_id: i64, role: &str, content: &str) -> AppResult<ChatMessage>;
pub fn update_message(conn: &Connection, id: i64, content: &str) -> AppResult<()>;
pub fn delete_message(conn: &Connection, id: i64) -> AppResult<()>;

// repo/styles.rs
pub fn list(conn: &Connection) -> AppResult<Vec<StyleCard>>;
pub fn create(conn: &Connection, name: &str, prompt_md: &str, sample_md: &str, tags: &str) -> AppResult<StyleCard>;
pub fn update(conn: &Connection, id: i64, name: &str, prompt_md: &str, sample_md: &str, tags: &str) -> AppResult<StyleCard>;
pub fn delete(conn: &Connection, id: i64) -> AppResult<()>;
```

- [ ] **Step 1: 迁移 SQL** `0002_m1.sql`

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  prompt_md TEXT NOT NULL,
  sample_md TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

db.rs 的 Migrations vec 追加 `M::up(include_str!("../migrations/0002_m1.sql"))`。

- [ ] **Step 2: 写失败测试** `src-tauri/tests/m1_repo_test.rs`（`test_conn()` 同 M0 模式；覆盖：settings set/get 往返、providers 解析/增改删、active_provider、session get_or_create 幂等（两次返回同 id）、messages 追加/更新/级联删除、styles CRUD）

- [ ] **Step 3: 红灯确认 → Step 4: 实现（models + 三仓库文件，逐字按 Interfaces）→ Step 5: 绿灯**
- [ ] **Step 6: Commit** `feat: M1 数据层——settings/sessions/messages/styles 仓库与迁移`

### Task M1-T2: LLM provider 模块（流式调用与 SSE 解析）

**Files:**
- Create: `src-tauri/src/llm/mod.rs`、`src-tauri/src/llm/provider.rs`、`src-tauri/src/llm/stream.rs`、`src-tauri/tests/llm_test.rs`
- Modify: `src-tauri/Cargo.toml`（`cargo add async-openai tokio --features tokio/full futures`）、`src-tauri/src/lib.rs`（`pub mod llm;`）

**Interfaces:**
- Consumes: T1 `repo::settings::providers / active_provider_id`
- Produces:

```rust
// llm/provider.rs
pub fn resolve(conn: &Connection) -> AppResult<ProviderProfile>; // active_provider_id → providers 中查找；无 active 或缺失 → AppError::Invalid("未配置可用的 AI 服务商")
// llm/stream.rs
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent { Delta { text: String }, Done { session_id: i64, content: String }, Error { message: String } }

pub fn parse_sse_line(line: &str) -> Option<String>;          // "data: {...}" → delta content 文本；[DONE]/心跳/空行 → None
pub struct StreamReq { pub base_url: String, pub api_key: String, pub model: String,
                       pub system: String, pub history: Vec<(String, String)>, /*(role, content)*/
                       pub user: String, pub max_tokens: i64, pub temperature: f64 }
pub async fn chat_stream(req: StreamReq, session_id: i64, mut cancelled: tokio::sync::watch::Receiver<bool>)
    -> Result<tokio::sync::mpsc::Receiver<StreamEvent>, AppError>;
```

- [ ] **Step 1: 写失败测试** `llm_test.rs`
  1. `parse_sse_line("data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}") == Some("你好")`
  2. `parse_sse_line("data: [DONE]") == None`；`parse_sse_line(": ping") == None`；空 delta（只有 role）→ None
  3. `resolve`：settings 空 → Err(Invalid)；有 2 providers + active=2 → 返回 id=2 的档案；active 指向不存在 id → Err
  4. `#[ignore]` 活体测试 `live_stream_smoke`：环境变量 `BIXIAN_LIVE_BASE_URL/API_KEY/MODEL` 存在才执行——发一句「回复：好」，收集 Delta 直到 Done，断言非空
- [ ] **Step 2: 红灯 → 实现**：
  - `parse_sse_line`：跳过非 `data:` 行；`[DONE]`→None；serde_json 解析 `choices[0].delta.content`（缺失→None）
  - `chat_stream`：用 async-openai `Client::with_config(OpenAIConfig::new().with_api_base(base_url).with_api_key(api_key))`；`CreateChatCompletionRequestArgs` 构建（messages = system + history + user）；`client.chat().create_stream(req)`；`tokio::spawn` 循环 `while let Some(chunk) = stream.next().await`——每个 delta `tx.send(Delta).await`；`cancelled` 变 true 时 break；结束后 `tx.send(Done{session_id, 全文拼接})`。错误映射为一次 `Error` 事件后结束（**错误文本必须含原始错误但不含 api_key**）
- [ ] **Step 3: cargo test（含 `cargo test -- --ignored` 说明：无环境变量时活体测试自动跳过）全绿**
- [ ] **Step 4: Commit** `feat: LLM provider 解析与流式 SSE 模块`

### Task M1-T3: ContextAssembler 上下文组装器

**Files:**
- Create: `src-tauri/src/context/mod.rs`、`src-tauri/src/context/assembler.rs`、`src-tauri/tests/assembler_test.rs`
- Modify: `src-tauri/src/lib.rs`、`src-tauri/src/util.rs`（新增 `pub fn estimate_tokens(text: &str) -> i64`）

**Interfaces:**
- Consumes: T1 styles/settings、M0 chapters
- Produces:

```rust
// util.rs
pub fn estimate_tokens(text: &str) -> i64; // CJK字*1.6 + 拉丁词*1.3，向上取整——仅估算用途

// context/assembler.rs
pub struct SlotLog { pub name: String, pub source: String, pub chars: i64, pub est_tokens: i64, pub preview_head: String } // preview_head ≤120 字符
#[derive(serde::Serialize)]
pub struct AssemblyLog { pub slots: Vec<SlotLog>, pub total_est_tokens: i64 }
pub struct AssembleInput<'a> {
    pub book_title: &'a str,
    pub style_prompt: Option<&'a str>,     // 激活文风卡的 prompt_md
    pub chapter_text: &'a str,             // 当前章已写正文
    pub prev_chapter_tail: Option<&'a str>,// 上一章尾部
    pub instruction: &'a str,
}
pub struct Assembled { pub system: String, pub history: Vec<(String, String)>, pub user: String, pub log: AssemblyLog }
pub const CHAPTER_WINDOW_CHARS: usize = 4000;  // 当前章尾部窗口
pub const PREV_WINDOW_CHARS: usize = 1000;     // 上一章尾部窗口
pub fn assemble(input: &AssembleInput) -> Assembled;
```

组装语义（写进测试断言）：
- system = 默认创作提示（固定文案：「你是长篇小说《{book_title}》的合著者。续写须与既有正文风格、人称、时态保持一致，直接输出正文，不要解释。」）+ 若有文风则追加「\n\n【文风要求】\n{style_prompt}」
- user = 若 chapter_text 非空：「【当前章节已有正文（尾部）】\n{尾窗}\n\n【写作指令】\n{instruction}」否则直接 instruction
- prev_chapter_tail 以独立 history 条目 (role="user", 「【上一章结尾】\n{尾窗}」) 放在最前（M1 简化，不进 system）
- log 逐槽记录：System/文风/上一章结尾/当前章正文/写作指令 + total
- 窗口截断按字符（chars().skip(总长-窗口)），中文按 char 不按 byte

- [ ] **Step 1: 失败测试**（覆盖：无文风/有文风 system 拼接、长文本截断窗口长度正确且保留尾部、空正文 user 仅指令、log 槽位数与 token>chars 关系、estimate_tokens("你好 world") 有界断言）
- [ ] **Step 2: 红灯 → Step 3: 实现 → Step 4: 绿灯**
- [ ] **Step 5: Commit** `feat: ContextAssembler 组装器与槽位日志（文风+前文滑窗+指令）`

### Task M1-T4: 流式命令层（会话/发送/取消/预览/Provider CRUD）

**Files:**
- Create: `src-tauri/src/commands_ai.rs`、`src-tauri/tests/commands_ai_test.rs`
- Modify: `src-tauri/src/state.rs`（AppState 增 `pub cancels: std::sync::Mutex<std::collections::HashMap<i64, tokio::sync::watch::Sender<bool>>>`）、`src-tauri/src/lib.rs`（注册命令）、`src-tauri/Cargo.toml`（如缺 tokio）

**Interfaces:**
- Consumes: T1-T3 全部
- Produces（命令名 = 前端 invoke 名；inner 同 M0 模式可测）:

```rust
// provider
list_providers / save_provider(p: ProviderProfile) / delete_provider(id) / set_active_provider(id)
// styles
list_styles / save_style(id, name, prompt_md, sample_md, tags) / delete_style(id)
set_active_style(book_id, style_id)
// sessions & chat
list_sessions(chapter_id) / get_or_create_session(chapter_id)   // title=「章节名 · AI」
list_messages(session_id)
delete_message(id)
send_message(app: AppHandle, state, session_id, instruction) -> AppResult<ChatMessage> // 立即落库 user 消息并返回；流式后台任务
cancel_generation(session_id)
preview_context(state, session_id, instruction) -> AppResult<AssemblyLog>
```

`send_message_inner` 流程：resolve provider → 读 chapter 正文（read_chapter_inner）→ 读激活文风（无则 None）→ 组装上一章尾部（同书 sort_key 前一章，无则 None）→ `append_message(user)` → 构建 `StreamReq` → `chat_stream(...)` → 存 cancel sender → `tauri::spawn` 异步任务：循环收 mpsc 事件，`app.emit(format!("stream://{}", session_id), ev)`；Delta 增量累积；Done 时 `append_message(assistant, 全文)` 再 emit Done；Error 时 emit（不落库）。**注意**：`#[tauri::command] async fn` 需要 `async fn` + 返回前先完成落库；emit 用 `tauri::Emitter` trait。

- [ ] **Step 1: 失败测试**（inner 级：无 provider 时 send_message_inner 返回 Invalid 错误；preview_context 空书返回含 System+指令 两槽的 log；save_provider 新增后 list 长度+1 且 api_key 原样；cancel 对未知 session 返回 Ok）
- [ ] **Step 2: 红灯 → 实现 → 绿灯 → cargo build 通过（确认 async command 与 Emitter 接线编译）**
- [ ] **Step 3: Commit** `feat: AI 命令层——会话/流式发送/取消/预览/Provider 与文风 CRUD`

### Task M1-T5: 前端——Provider 设置模态 + tauri 封装扩展

**Files:**
- Modify: `src/lib/tauri.ts`（新增 M1 全部 api 封装与接口类型 ProviderProfile/ChatSession/ChatMessage/StyleCard/AssemblyLog）
- Create: `src/components/settings/SettingsModal.tsx`、`src/stores/settings.ts`、`src/stores/settings.test.ts`
- Modify: `src/components/layout/Sidebar.tsx`（顶部 Settings 图标 → 打开模态）

**要点**：模态（fixed 遮罩 + 居中卡片 bg-panel border rounded-lg max-w-xl）：Provider 列表（名称/模型/base_url，单选激活 = accent 边）+ 新增/编辑表单（六字段，api_key 用 password input）+「测试连接」按钮（M1 简版：调 save 后用空指令 preview_context 代替真实连通测试——不引入额外命令）+ 删除。表单校验：名称/model/base_url 非空。store 用 zustand：`{providers, activeId, load(), save(), remove(), activate()}`。测试：store 逻辑（mock tauri.ts，模式同 M0）。

- [ ] **Step 1: 失败 store 测试 → 实现 → 绿**；**Step 2: pnpm test/build 绿；Step 3: Commit** `feat: Provider 设置模态与 M1 tauri 封装`

### Task M1-T6: 前端——AI Dock（消息流+输入+流式渲染+采纳）

**Files:**
- Create: `src/components/chat/AiDock.tsx`、`src/components/chat/MessageBubble.tsx`、`src/stores/chat.ts`、`src/stores/chat.test.ts`
- Modify: `src/components/editor/EditorPane.tsx`（垂直 PanelGroup：编辑器上、AiDock 下，AiDock 可 180-480px 拖高可折叠成 36px 条）、`src/stores/workspace.ts`（暴露 `appendChapterText(text)`：把采纳文本写入当前编辑器）

**要点**：
- 选章节时 `get_or_create_session` + `list_messages` 初始化
- 发送：乐观插入 user 气泡；`listen(`stream://${sessionId}`)` 收 Delta 追加到进行中气泡（自动滚底）；Done 落定并刷新；Error 显示红色条
- 采纳：assistant 气泡 hover 出现「采纳进正文」按钮 → `appendChapterText(content)` → 追加到编辑器（ChapterEditor 暴露 `window.__bixian_append`? **不要全局 hack**：workspace store 加 `pendingAppend: string | null`，ChapterEditor useEffect 消费后清 null）
- 气泡样式：user 右侧 accent-dim 底、assistant 左侧 bg-elevated；流式中显示闪烁光标 `▍`（animate-pulse）
- 「停止」按钮发送中可见 → `cancel_generation`

- [ ] **Step 1: store 失败测试（mock：delta 累积→done 落定、error 状态、采纳置 pendingAppend）→ 实现 → 绿**；**Step 2: 三件套绿；Step 3: Commit** `feat: AI Dock 消息流——流式渲染/停止/采纳进正文`

### Task M1-T7: 前端——文风库面板

**Files:**
- Create: `src/components/styles/StylePanel.tsx`、`src/stores/styles.ts`、`src/stores/styles.test.ts`
- Modify: `src/components/layout/PanelDock.tsx`（TABS 加「文风」，Sparkles 图标）

**要点**：列表（名称+标签 chips+激活标记）；编辑卡表单：名称/风格指令 textarea/样章 textarea/标签（逗号分隔）；「导入 md」按钮用 `<input type="file" accept=".md">` 前端读文本 → 预填风格指令（导入的 skill md 全文进 prompt_md）；「预览」按钮：模态展示 sample_md（若空提示先填）；每书激活：面板顶部下拉（当前书 + 无文风选项）。store 模式同前。

- [ ] **Step 1: store 失败测试 → 实现 → 绿；Step 2: 三件套绿；Step 3: Commit** `feat: 文风库面板——CRUD/样章预览/skill md 导入/每书激活`

### Task M1-T8: 上下文预览面板 + M1 打包收尾

**Files:**
- Create: `src/components/chat/ContextPreview.tsx`
- Modify: `src/components/chat/AiDock.tsx`（顶栏加「预览」切换：消息流视图/组装日志视图；输入框旁「预览」按钮调 preview_context 渲染 AssemblyLog）

**要点**：槽位卡片列表（名称+来源+字数+估算 token+120 字预览灰底），顶部总估算；输入指令变化时手动刷新（不自动）。README 补 M1 功能说明。三件套绿后 `pnpm tauri build --no-bundle` 产物确认。Commit：`feat: 上下文预览面板与 M1 收尾`。

---

## 计划自审记录

- 规格覆盖：F1 全部要素（Provider 档案/会话/流式协议/ContextAssembler 三槽简版/文风库含 skill 导入/上下文预览面板/消息流 UI）；§4.4 可见性要求由 T8 预览面板落实；M2/M3 槽位以 `AssembleInput` 扩展字段形式预留，不预实现
- 占位符扫描：无 TBD；前端任务以「要点+store 测试先行」约束行为，组件细节交由既定设计规范（cc-gui 质感，见 M0 UI 任务规范）与代理实现
- 类型一致性：StreamEvent 信封、AssemblyLog/SlotLog、ProviderProfile 等在 T2/T3/T4/T5 间同名同字段；`pendingAppend` 单一通道采纳
