# 笔仙 M2 ACP 免配置 + 导航重构 + 基础功能 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 笔仙获得：① ACP（Agent Client Protocol）接入本机 agent（Claude Code/Codex/Gemini 等），免手动配 API key；② 一级/二级页面注册系统 + Obsidian 式侧边栏折叠（ribbon 图标条）；③ 多主题模块；④ 碰碰车升一级视图并给最小可用版；⑤ 作家助手迁移的基础功能（回收站/版本历史快照/导入导出/全书搜索/写作统计/敏感词）。

**Architecture:** Rust 侧新增 `agents/`（ACP 注册表/探测/连接/会话）、`history.rs`（快照）、`porting/`（导入导出）、`search.rs`（全书搜索）；迁移 0003 扩展表。前端新增 ribbon 导航 + navRegistry（一级视图注册）、themes/（主题定义）、外观设置、回收站/历史/导入导出/搜索/碰碰车面板。原 M2 人物图谱顺延为 M3。

**Tech Stack:** Rust 新增 `agent-client-protocol 1.x`（zed 官方 crate，Agentero 同款）、`chardetng` + `encoding_rs`（编码检测）、`docx-rs`（docx 读写）、`aho-corasick`（敏感词）。前端新增 `diff`（jsdiff，快照 diff 预览）。其余沿用 M0/M1 栈。

**Spec:** `docs/specs/2026-09-19-bixian-spec.md`。三份调研报告结论已内联本计划（Agentero: D:\Mycraft\research\Agentero；codeg: D:\Mycraft\research\codeg；作家助手: D:\author——只读参考，勿修改）。

## Global Constraints

- 沿用 M0/M1 全部约束：Tauri 2.x 稳定版、返回结构体 snake_case、命令参数 JS camelCase、文案中文、每任务三件套（cargo test / pnpm test / pnpm build）全绿才提交、commit 规范、只引入列出依赖
- **ACP 铁律**（来自两份调研的坑）：
  - 权限请求（session/request_permission）handler **不得在 dispatch loop 内阻塞应答**——先入队 emit 前端，前端应答后异步回写（Agentero TurnRegistry 模式）
  - Windows 子进程必须 `CREATE_NO_WINDOW (0x0800_0000)`，退出时 kill 进程树
  - GUI 进程 PATH 与终端不同：命令发现 = which → `%APPDATA%\npm` → PATHEXT 顺序（exe→cmd→bat）
  - delta 事件合并发射（StreamCoalescer 思路，~25次/秒上限），防前端事件洪水
- 手动 Provider（M1 HTTP 直连）**保留**为高级后备；ACP agent 为默认推荐路径
- md 文件唯一真源不变；`.trash/`、`.history/` 为库内隐藏目录，rescan/搜索/统计/导出一律排除

---

### Task M2-T1: 导航架构重构——navRegistry + Ribbon + 侧边栏折叠

**Files:**
- Create: `src/lib/nav/registry.ts`、`src/lib/nav/uiStore.ts`、`src/components/layout/Ribbon.tsx`、`src/views/WriteView.tsx`、`src/views/BumpView.tsx`（占位）
- Modify: `src/App.tsx`（挂 Ribbon + 活动视图）、`src/components/layout/AppShell.tsx`、`src/components/layout/Sidebar.tsx`（折叠按钮）、`src/components/layout/PanelDock.tsx`（按视图动态读 dockPanels）
- Test: `src/lib/nav/registry.test.ts`、`src/lib/nav/uiStore.test.ts`

**Interfaces:**

```ts
// src/lib/nav/registry.ts —— 一级视图注册表（仿 Agentero 命令式注册）
export type DockPanelDef = { id: string; label: string; icon: LucideIcon }; // 二级面板注册（右侧 dock tab）
export type NavView = {
  id: string;                    // "write" | "bump"
  label: string;                 // "写作" | "碰碰车"
  icon: LucideIcon;              // Ribbon 图标
  Component: React.ComponentType; // 一级视图根组件
  dockPanels: DockPanelDef[];    // 该视图的二级面板（PanelDock 动态渲染）
};
export function registerView(v: NavView): void;   // 幂等（按 id 去重）
export function getViews(): readonly NavView[];

// src/lib/nav/uiStore.ts —— zustand
{ activeView: string; sidebarCollapsed: boolean; toggleSidebar(): void; setView(id): void }
// activeView 持久化 localStorage("bixian.nav.view")
```

**要点：**
- **Ribbon**（Obsidian 式）：48px 竖条永远可见——顶部笔仙 logo、中部一级视图图标（激活态左侧 2px accent 竖条）、底部设置齿轮。切换视图 = 切换中央区整块内容
- **写作视图**（WriteView）：现有三栏（Sidebar + EditorPane + PanelDock）原样迁入；PanelDock 的 tabs 由 `activeView.dockPanels` 驱动（M2 写作视图 = 大纲/人物/伏笔/文风）
- **碰碰车视图**（BumpView）：M2-T1 先占位（居中图标 + 「碰撞器即将开放」）；T10 填充
- **侧边栏折叠**（抄 Agentero 同库手法，react-resizable-panels v4）：
  - Panel `collapsible collapsedSize="0"`，命令式 `panelRef.collapse()/expand()`
  - 动画：折叠/展开期间给 Group 挂 `data-rail-animating` 属性，CSS `[data-rail-animating] * { transition: flex-grow 200ms }` 补间，结束移除（库不支持动画的零依赖解法）
  - 用户拖宽记忆：onResize 时写 `localStorage("bixian.nav.sidebarPct")`，展开时优先恢复
  - 折叠态下 Sidebar 与其 Separator 不渲染（无可拖缝隙）
  - 入口：Sidebar 头部 PanelLeftClose/PanelLeftOpen 图标 + Ribbon 上当前视图图标再次点击切换折叠
- AppShell 外层变为：`<div class="flex h-full"><Ribbon/><Group>…</Group></div>`（Group 只含 sidebar/editor/dock 三 Panel）

- [ ] Step 1: registry/uiStore 失败测试（注册去重、视图切换持久化、折叠状态）→ 实现 → 绿
- [ ] Step 2: 组件改造（Ribbon/WriteView/BumpView/AppShell/Sidebar/PanelDock）→ 三件套绿
- [ ] Step 3: Commit `feat: navRegistry 一级视图注册 + Ribbon 导航 + 侧边栏折叠`

### Task M2-T2: 主题模块（多主题/明暗跟随系统/UI 缩放）

**Files:**
- Create: `src/themes/defs.ts`（主题定义）、`src/themes/ThemeProvider.tsx`、`src/components/settings/AppearancePane.tsx`
- Modify: `src/styles.css`（:root 变量改为基础变量+暗色默认）、`src/components/settings/SettingsModal.tsx`（加「外观」tab）、`src/lib/tauri.ts`（appearance 读写）
- Rust: settings 表复用（key="appearance"，值 JSON `{"colorTheme":"bixian-dark","mode":"system"|"light"|"dark","uiScale":1}`）
- Test: `src/themes/themes.test.ts`

**Interfaces:**

```ts
// src/themes/defs.ts
export type ThemeDef = { id: string; name: string; dark: boolean; vars: Record<string, string> };
// vars 覆盖 styles.css 的 16 个 CSS 变量（--bg-base/--bg-panel/--accent 等）
export const THEMES: ThemeDef[] = [
  bixianDark,   // 现有深色（默认）
  bixianLight,  // 浅色
  ink,          // 墨色（纯黑高对比）
  parchment,    // 羊皮纸（写作暖色）
  matcha,       // 护眼绿
  midnightBlue, // 午夜蓝
];
// ThemeProvider：html class "dark"/"light"（mode=system 时 matchMedia 倾听）+
// <style id="bixian-theme">:root{--k:v;…}</style> 动态注入/移除（Agentero applyUiTheme 手法）
// UI 缩放：document.documentElement.style.fontSize = 16*scale px（rem 基准）
```

**要点：** 编辑器衬线正文区颜色也走变量（--prose-fg）随主题变；tauri.conf.json 窗口 titleBarTheme 无法动态改，接受重启后完全一致；全部现有组件的 Tailwind arbitrary 值 `var(--…)` 不动，自动生效。

- [ ] Step 1: 主题 defs + Provider 失败测试（应用/切换/持久化/跟随系统）→ 实现 → 绿
- [ ] Step 2: AppearancePane（主题卡片网格预览 + 明暗三选 + 缩放滑条）→ 三件套绿
- [ ] Step 3: Commit `feat: 主题模块——六主题/明暗跟随系统/UI 缩放`

### Task M2-T3: ACP agent 注册表与探测（Rust）

**Files:**
- Create: `src-tauri/src/agents/mod.rs`、`src-tauri/src/agents/registry.rs`（模板+agents.json 存储）、`src-tauri/src/agents/discover.rs`（命令发现）、`src-tauri/src/agents/probe.rs`（短连接探测）、`src-tauri/tests/agents_test.rs`
- Modify: `src-tauri/Cargo.toml`（+agent-client-protocol）、`src-tauri/src/lib.rs`
- Add dep: `agent-client-protocol = "1.2"`（zed 官方；若编译特性问题以 crates.io 文档为准调整小版本）

**Interfaces:**

```rust
// models.rs 新增
pub struct AgentDescriptor {
  pub id: String,               // "claude" | "codex" | "gemini" | "custom:xxx"
  pub name: String,             // "Claude Code"
  pub command: String,          // "claude-agent-acp"
  pub args: Vec<String>,        // gemini: ["--acp","--skip-trust"]
  pub enabled: bool,
  pub is_default: bool,
  pub last_probe: Option<ProbeResult>,
}
pub struct ProbeResult { pub ok: bool, pub agent_name: Option<String>,
  pub protocol_version: Option<String>, pub can_resume: bool, pub detail: Option<String> }

// registry.rs —— 内置模板（探测命令/ACP 命令来自调研映射表）
// claude: cmd=claude-agent-acp args=[] ; codex: cmd=codex-acp args=[]
// gemini: cmd=gemini args=["--acp","--skip-trust"] ; custom: 用户填
// 存 %APPDATA%/com.bixian.app/agents.json（原子 temp+rename 写）
pub fn list(config_dir) -> Vec<AgentDescriptor>;
pub fn upsert(config_dir, &AgentDescriptor) -> ();
pub fn remove(config_dir, id) -> ();
pub fn set_default(config_dir, id) -> ();

// discover.rs
pub fn resolve_command(name: &str) -> Option<std::path::PathBuf>;
// which crate → 失败则 %APPDATA%\npm\{name}.cmd（Windows）→ PATHEXT 顺序 exe/cmd/bat

// probe.rs —— 一次性短连接：spawn → initialize → 读 agent_info/session capabilities → kill
pub async fn probe(desc: &AgentDescriptor) -> ProbeResult; // 超时 15s；探测期权限请求自动拒绝
```

Tauri 命令：`agents_list / agents_probe(id) / agents_upsert(desc) / agents_remove(id) / agents_set_default(id)`（全部薄包装 inner 可测模式）。

- [ ] Step 1: 失败测试（registry CRUD/默认项/JSON 原子写、resolve_command 对不存在名返回 None）→ 实现 → 绿
- [ ] Step 2: `#[ignore]` 活体探测测试（环境变量 `BIXIAN_AGENT_CMD` 提供才跑，如本机 claude-agent-acp）→ cargo test 绿
- [ ] Step 3: Commit `feat: ACP agent 注册表——内置模板/命令发现/短连接探测`

### Task M2-T4: ACP 连接/会话/流式/权限（Rust）

**Files:**
- Create: `src-tauri/src/agents/session.rs`（run_turn 主流程）、`src-tauri/src/agents/interaction.rs`（权限队列）、`src-tauri/tests/agents_session_test.rs`
- Modify: `src-tauri/migrations/`（0003：sessions 加 `source TEXT NOT NULL DEFAULT 'provider'`——ACP 会话存 `'agent:{id}'`）、`src-tauri/src/state.rs`（AppState 加 `acp: Mutex<HashMap<i64, AcpHandle>>`）、`src-tauri/src/repo/sessions.rs`、`src-tauri/src/commands_ai.rs`、`src-tauri/src/lib.rs`

**Interfaces（核心调用形态，抄 Agentero client.rs 已验证 API）：**

```rust
use agent_client_protocol::{Agent, Client, ProtocolVersion, InitializeRequest, ClientCapabilities,
  McpServer, McpServerStdio, NewSessionRequest, PromptRequest, CancelNotification,
  ContentBlock, SessionUpdate, RequestPermissionRequest, RequestPermissionResponse, RequestPermissionOutcome};

// session.rs
pub struct AcpHandle { cancel: tokio::sync::watch::Sender<bool>, session_id: agent_client_protocol::SessionId }

/// 一回合：resolve agent → spawn(三层：PATH 解析 > 裸命令) → initialize(capabilities 只开必需)
/// → session/new（cwd=书目录）→ prompt(ContentBlock::Text 组装产物) → 流式转发 → done 落库
pub async fn run_turn(app: AppHandle, s: &AppState, chat_session_id: i64, desc: AgentDescriptor, prompt: String)
  -> AppResult<()>;
// spawn 细节：tokio::process::Command；Windows #[cfg(windows)] CREATE_NO_WINDOW；
// env 继承 + PATH 前置注入发现目录；退出 kill 进程树（ChildGuard drop）
// 事件 emit（EventEnvelope 思路收敛为 3 个）：
//   "agent://stream"  { session_id, text }        —— delta，StreamCoalescer ≤25次/秒合并
//   "agent://permission" { session_id, request_id, title, options[{id,name,kind}] }
//   "agent://turn"    { session_id, ok, content?, error? }  —— 回合结束（done 或 error），先落库 assistant 再 emit

// interaction.rs —— TurnRegistry 模式：连接时预装静态 RequestPermission handler，
// handler 内只做：入 PendingPermissions + emit（立即返回，不阻塞 dispatch loop）；
// 前端应答经命令 agents_respond_permission(session_id, request_id, option_id)
// → oneshot 回写 RequestPermissionOutcome::Selected/Cancelled；300s 超时自动 Cancelled
```

**prompt 组装（envelope 模式）**：复用 ContextAssembler——ACP 无 system 字段，把 `assembled.system + "\n\n" + assembled.user` 合并为单条 prompt 文本（文风卡/前文滑窗/指令全部保留）。取消：`cancel_generation` 复用（watch 通道），发 CancelNotification。

- [ ] Step 1: 失败测试（envelope 合并文本断言；permission 队列入队/应答/超时单元测——用假 gate 不真连）→ 实现 → 绿
- [ ] Step 2: `#[ignore]` 活体回合测试（BIXIAN_AGENT_CMD 存在才跑：发「回复：好」收流式断言非空）→ cargo test 绿 + cargo build 编译接线确认
- [ ] Step 3: Commit `feat: ACP 会话——spawn/流式/权限队列/取消与迁移0003`

### Task M2-T5: 前端 ACP 接入——AI Dock 双后端 + Agent 设置 + 权限弹卡

**Files:**
- Create: `src/components/chat/BackendSelector.tsx`（Dock 顶栏后端下拉）、`src/components/chat/PermissionCard.tsx`、`src/components/settings/AgentsPane.tsx`、`src/stores/agents.ts`
- Modify: `src/components/chat/AiDock.tsx`、`src/stores/chat.ts`（send 分流）、`src/components/settings/SettingsModal.tsx`（「Agent」tab 排最前）、`src/lib/tauri.ts`

**要点：**
- **BackendSelector**：下拉项 = agents_list 中 enabled 且探测 ok 的 agent（图标+名称+默认徽章）+ 「API 直连（高级）」项（走 M1 provider）。选择存 settings key="chat:backend"（`"agent:claude"` 或 `"provider"`），全局记忆
- **chat.send 分流**：agent 后端 → invoke `send_message_acp(session_id, instruction)`（Rust 侧组装+run_turn；user 消息同样先落库）；provider 后端 → 现有 send_message。**前端流式渲染统一**：agent://stream 事件也写入 streamText（与 stream:// 一致的展示路径）；agent://turn 落定
- **PermissionCard**：listen("agent://permission") → 消息流顶部插入黄色卡（工具名+按钮组：允许一次/总是允许/拒绝/总是拒绝）→ invoke agents_respond_permission
- **AgentsPane**：agent 列表（名称/命令/探测状态点：绿 ok 红 fail 灰未测/默认徽章/启用开关）+ 「探测」按钮 + 安装提示（未探测到命令时显示 `npm i -g @agentclientprotocol/claude-agent-acp` 等可复制命令——不做自动安装器，Backlog）+ 自定义 agent 表单（name/command/args）
- 无 provider 且无 agent 时 BackendSelector 显示「去设置 Agent」引导

- [ ] Step 1: agents store 失败测试（列表加载/探测状态回写/默认切换）→ 实现 → 绿
- [ ] Step 2: 组件接入 → 三件套绿
- [ ] Step 3: Commit `feat: AI Dock 双后端——ACP agent 直连 + 权限弹卡 + Agent 设置`

### Task M2-T6: 回收站（.trash/ + deleted_at）

**Files:**
- Create: `src-tauri/src/trash.rs`、`src-tauri/tests/trash_test.rs`、`src/components/sidebar/TrashPanel.tsx`
- Modify: 迁移 0003 追加（chapters 加 `deleted_at TEXT`、`orig_file_path TEXT`）、`src-tauri/src/repo/chapters.rs`（list_by_book 过滤 deleted_at IS NULL；soft_delete/restore/purge）、`src-tauri/src/commands.rs`、`src/components/layout/Sidebar.tsx`（顶部「回收站」入口图标）

**语义（作家助手做法的 md 真源版）：**
- 删除章 = md 移到 `{book}/.trash/{原文件名}` + chapters 行标 deleted_at/orig_file_path；删除书 = 整书目录移 `{library}/.trash_books/{slug}` + books 行标 deleted_at（books 表也加 deleted_at）
- 恢复 = 文件移回 orig_file_path + 清 deleted_at；彻底删除 = 删文件 + 删行；回收站面板按时间倒序、支持清空
- rescan_library / 搜索 / 统计 / 导出一律排除 `.trash*`（T7-T9 消费同一约定）

命令：`list_trash(book_id?) / restore_chapter(id) / purge_chapter(id) / empty_trash(book_id)`。

- [ ] Step 1: 失败测试（软删→文件在 .trash→列表过滤→恢复→文件归位；purge 真删；rescan 排除）→ 实现 → 绿
- [ ] Step 2: TrashPanel（列表+恢复/彻底删/清空，确认弹层）→ 三件套绿
- [ ] Step 3: Commit `feat: 回收站——.trash 软删除/恢复/清空`

### Task M2-T7: 章节快照版本历史

**Files:**
- Create: `src-tauri/src/history.rs`、`src-tauri/tests/history_test.rs`、`src/components/editor/HistoryPanel.tsx`
- Modify: `src-tauri/src/commands.rs`（write_chapter 内嵌 snapshot 钩子 + 3 个新命令）、`src/components/editor/ChapterEditor.tsx`（顶栏「历史」按钮开侧滑面板）、`package.json`（+diff）
- Add dep: 前端 `diff`（jsdiff）

**策略（抄作家助手 LocalHistory，改人类可读存储）：**

```rust
// history.rs —— {book}/.history/{chapter-slug}/ 下
//   {YYYY-MM-DD-HH-mm-ss}_{字数N}.md   全文快照（非 diff）
//   index.json  {"list":[{file,ts,words,title}]}  上限 50 滚动（shift 最旧）
pub fn snapshot(book_dir: &Path, slug: &str, title: &str, content: &str) -> bool;
// 归一化比对（去 \r、trim 行尾空白、压连续空行）与最近快照不同才写；空内容跳过
pub fn list_snapshots(book_dir, slug) -> Vec<SnapshotInfo>;   // 读 index.json
pub fn read_snapshot(book_dir, slug, file) -> AppResult<String>;
// 恢复在前端组合：先把当前内容 snapshot 一次（往返安全）→ write_chapter 覆盖
```

**HistoryPanel**：快照列表（时间+字数，当前内容与选中快照 diff 视图——jsdiff 按行红绿着色）+「恢复此版本」（恢复前提示会先存当前状态）。

- [ ] Step 1: 失败测试（首存快照/相同内容不重复/51 个滚动删最旧/index 与文件一致/跨章隔离）→ 实现 → 绿
- [ ] Step 2: write_chapter 钩子 + 命令 + HistoryPanel → 三件套绿
- [ ] Step 3: Commit `feat: 章节快照版本历史——保存去重/50滚动/diff预览/恢复`

### Task M2-T8: 导入导出（txt/docx）

**Files:**
- Create: `src-tauri/src/porting/mod.rs`、`src-tauri/src/porting/import.rs`、`src-tauri/src/porting/export.rs`、`src-tauri/tests/porting_test.rs`、`src/components/io/ImportWizard.tsx`、`src/components/io/ExportDialog.tsx`
- Modify: `src-tauri/src/commands.rs`、`src/components/layout/Sidebar.tsx`（书列表头「导入」「导出」按钮）、`src/lib/tauri.ts`
- Add deps: `chardetng`、`encoding_rs`、`docx-rs`（读+写）；文件对话框用 tauri plugin dialog（M0 已带 opener，需 `cargo add tauri-plugin-dialog` + pnpm add @tauri-apps/plugin-dialog）

**Interfaces:**

```rust
// import.rs
pub fn detect_and_decode(bytes: &[u8]) -> String;              // chardetng 猜 + encoding_rs 解（GBK/GB18030/UTF-8）
pub struct ParsedChapter { pub title: String, pub content: String, pub volume: Option<String> }
pub fn split_txt(text: &str) -> Vec<ParsedChapter>;
// 分章正则（作家助手 importUtil 还原 + 笔仙增强）：
//   卷 /^第[〇一二三四五六七八九十百千\d]+卷/；章 /^第.{0,20}?[章回节集]/；
//   特殊标题行（序章|楔子|番外|尾声|终章|后记）单独成章；\ufeff 分隔多文档；
//   无任何匹配 → 全文作为第一章；章题截 35 字符
pub fn preview_import(text: &str) -> Vec<ParsedChapter>;        // 同 split，前端预览用
pub fn import_chapters(s, book_id, &[ParsedChapter]) -> ImportReport; // 批量 create_chapter（md 落盘+索引）
pub fn import_docx(bytes) -> Vec<ParsedChapter>;               // docx-rs 读段落 → 同 split 规则

// export.rs
pub struct ExportRange { pub chapter_ids: Vec<i64> }            // 前端勾选
pub fn export_txt(s, book_id, &ExportRange, indent: bool) -> AppResult<String /*saved path*/>;
// 卷标题行 + 章题 + 正文；indent=true 段首「　　」；\r\n（记事本兼容）
pub fn export_docx(s, book_id, &ExportRange) -> AppResult<String>; // 卷 Heading1/章 Heading2/段落，docx-rs
```

**ImportWizard**：选文件（dialog 插件）→ Rust preview → 章节列表勾选（含卷识别提示）→ 导入 → 报告（N 章/M 字）。**ExportDialog**：树形勾选卷章 → 格式二选一 → txt 缩进开关 → 保存路径选择。

- [ ] Step 1: 失败测试（GBK 解码/典型分章语料含卷+序章+番外+无标记全文/BOM 多文档/空行容错/导出 txt 缩进与换行/docx 生成非空 zip 结构）→ 实现 → 绿
- [ ] Step 2: 向导与对话框 UI + 对接 → 三件套绿
- [ ] Step 3: Commit `feat: 导入导出——txt分章/docx/编码检测/向导`

### Task M2-T9: 全书搜索

**Files:**
- Create: `src-tauri/src/search.rs`、`src-tauri/tests/search_test.rs`、`src/components/search/SearchPanel.tsx`、`src/stores/search.ts`
- Modify: `src-tauri/src/commands.rs`、`src/lib/tauri.ts`、快捷键 Ctrl+Shift+F（App.tsx 全局）

**Interfaces:**

```rust
// search.rs —— 朴素版起步：遍历当前书 manuscript/*.md（排除 .trash/.history）
pub struct SearchHit { pub chapter_id: i64, pub chapter_title: String, pub line_no: i64, pub line_text: String, pub match_start: i64, pub match_end: i64 }
pub fn search_book(s, book_id, query: &str, whole_word: bool) -> Vec<SearchHit>;
// 大小写不敏感子串（whole_word 用 char 边界判断）；单书 <10MB 量级毫秒级，不做 FTS（Backlog）
```

**SearchPanel**：输入框（防抖 300ms）+ 结果按章分组（章名+命中行上下文高亮）+ 点击跳章（selectChapter + 编辑器滚动到行号近似位置——TipTap 定位到第一个文本匹配处）+ 命中计数。替换 M2 不做（TipTap 章内查找替换用其扩展，Backlog 全书替换）。

- [ ] Step 1: 失败测试（多章命中/大小写/整词/排除 .trash）→ 实现 → 绿
- [ ] Step 2: SearchPanel + 快捷键 → 三件套绿
- [ ] Step 3: Commit `feat: 全书搜索——毫秒级全文扫描/跳章定位`

### Task M2-T10: 碰碰车最小版（一级视图填充）

**Files:**
- Create: `src/views/bump/BumpWorkspace.tsx`、`src/views/bump/IdeaCardShelf.tsx`、`src/stores/bump.ts`
- Modify: 迁移 0003 追加（`bump_words` 表：id/word/created_at；`ideas` 表：id/content TEXT/words_json/tags_json/created_at——M4 素材系统直接复用）、`src/views/BumpView.tsx`（替换占位）、`src-tauri/src/repo/`（bump.rs/ideas.rs）、`src-tauri/src/commands.rs`、`src/lib/tauri.ts`

**要点：**
- 词库管理：chips 增删（输入回车加词，点 × 删）+ 预置示例词（蝴蝶/菜刀/铁锅/雨夜/邮差…可清空）
- 碰撞：抽取数量滑条（2-4）+「碰撞」按钮 → 随机抽词组合展示大卡片（`词A × 词B`）+「换一组」
- 存灵感卡：组合结果 + 备注 → ideas 表；IdeaCardShelf 列表（卡片网格：词组/tags/时间/删除）
- 灵感卡后续 M4 接入 ContextAssembler 槽4 尾部——本任务只存不注入

- [ ] Step 1: 失败测试（words/ideas CRUD、随机抽取确定性——种子可测）→ 实现 → 绿
- [ ] Step 2: BumpWorkspace UI → 三件套绿
- [ ] Step 3: Commit `feat: 碰碰车一级视图——词库/随机碰撞/灵感卡`

### Task M2-T11: 写作统计 + 敏感词 + M2 收尾

**Files:**
- Create: `src-tauri/src/stats.rs`（writing_stats 读写）、`src-tauri/src/sensitive.rs`（aho-corasick 扫描）、`src-tauri/tests/stats_test.rs`、`src/components/sidebar/StatsBadge.tsx`、`src/components/editor/SensitiveDialog.tsx`
- Modify: 迁移 0003 追加（`writing_stats` 表：date TEXT/book_id/words INTEGER/active_minutes INTEGER，主键(date,book_id)）、`src/components/editor/ChapterEditor.tsx`（transaction 统计钩子 + 顶栏统计徽章 + 「检查」按钮）、`src/stores/stats.ts`、settings key="sensitive:words"（词库 JSON 数组，可导入 txt 一行一词）、README.md
- Add dep: `aho-corasick`

**统计规则（作家助手 net 增量语义）：**
- TipTap transaction：`tr.doc` 与旧 doc 差异字符数（insert 计 +、delete 计 −）；**粘贴**（meta 来自 paste）与 **AI 采纳**（pendingAppend 注入）不计；单次跳变 |Δ|>500 丢弃；每日 0 点按本地日期切；`writing_stats` upsert 累加
- StatsBadge：侧栏底部「今日 1,234 字」（当日该书 words）；active_minutes 简版=编辑器 focus 且有输入的分钟数（M2 不做挂机剔除，Backlog）

**敏感词：**
- `scan(content: &str, words: &[String]) -> Vec<Hit{word, byte_start, context}>`（aho-corasick，重叠不吞词）
- SensitiveDialog：「检查本章」→ 命中列表（词+上下文±20字）+ 词库管理（textarea 一行一词 + 导入 txt）+ 全部忽略按钮；检查纯手动（不自动改 md）

- [ ] Step 1: 失败测试（差量统计各规则/敏感词多命中与重叠/词库存取）→ 实现 → 绿
- [ ] Step 2: UI 接入 + README 补 M2 说明 → 三件套绿
- [ ] Step 3: `pnpm tauri build --no-bundle` 产物确认 → Commit `feat: 写作统计与敏感词检测 + M2 收尾`

---

## 计划自审记录

- 需求覆盖：用户五点需求全落位——ACP(T3/T4/T5，免手动配置=默认 agent 路径+探测+安装提示)、主题(T2)、一级二级注册(T1 navRegistry+dockPanels)、碰碰车一级(T1/T10)、侧边栏折叠(T1，Obsidian ribbon+Agentero 同库手法)、作家助手基础功能(T6 回收站/T7 快照/T8 导入导出/T9 搜索/T11 统计+敏感词)
- 调研内联：ACP 全部坑（权限队列化/CREATE_NO_WINDOW/PATH 发现/delta 合并）写进 Global Constraints 与 T4；分章正则/快照策略/回收站语义来自作家助手报告原文；主题/折叠/注册手法来自 Agentero 报告
- 里程碑重排：原 M2 人物图谱→M3，原 M3 大纲伏笔→M4，原 M4 素材→M5（ideas 表 T10 提前建，M5 复用）
- 不做（明确排除）：ACP agent 自动安装器（给 npm 命令提示即可）、FTS5、全书替换、云同步、SQLCipher、docx 格式保真导入（纯文本+分章够用）
- 迁移 0003 汇总：sessions.source、chapters.deleted_at/orig_file_path、books.deleted_at、bump_words、ideas、writing_stats——单迁移一次落库，T4 首建，T6/T10/T11 追加字段进同一文件（执行顺序 T4→T6→T10→T11，若顺序调整则拆 0003/0004/0005 递增）
- 类型一致性：AgentDescriptor/ProbeResult 在 T3/T4/T5 间同名同字段；agent:// 三事件在 T4/T5 对齐；.trash/.history 排除约定 T6 定义 T7/T8/T9 消费
