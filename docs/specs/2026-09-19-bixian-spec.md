# 笔仙 (Bixian) 产品与技术规格书 v1

- 日期：2026-09-19
- 状态：待用户批准
- 本文档是所有实现计划（docs/superpowers/plans/）的上游依据，计划与之冲突时以本文为准

## 0. 一句话定位

本地优先的 Rust 桌面 AI 长篇小说创作工具：**人写为主、AI 辅助**，以「人物图谱自动抽取、伏笔追踪、灵感碰撞」三块开源空白功能立足。

设计原则：**原子化**——人物卡、情节块、灵感卡、文风卡、伏笔皆为解耦可复用的「注入原子」（§4.4），复用与组合优先于重写；悬念伏笔（草蛇灰线）与新奇灵感的捕捉/注入是一等能力。

## 1. 背景与调研结论（2026-09-19 完成，后续会话无需重复调研）

| 结论 | 依据 |
|---|---|
| 技术栈定案：Tauri 2.x 稳定版 + React 18+/TS + Tailwind 4 前端，Rust 核心 | desktop-cc-gui 本身即此架构（4.2k★，极活跃）；纯 Rust GUI（egui 3/10）无富文本编辑器生态，Zed/Lapce 均自研不可复用 |
| 界面与架构模仿对象：desktop-cc-gui 三栏布局 + Engine trait/EngineEvent 流式事件模式 | github.com/zhukunpenglinyutong/desktop-cc-gui（Tauri 2 + React 18 + Zustand + rusqlite） |
| 角色卡/注入采用 Character Card V2 字段子集 + SillyTavern World Info 触发机制（关键词扫描 + scan_depth + token_budget + insertion_order + constant/触发二分 + 递归扫描） | github.com/malfoyslastname/character-card-spec-v2、docs.sillytavern.app/usage/core-concepts/worldinfo/ |
| 人物图谱 = 简化 HippoRAG：分章 LLM 三元组抽取（实体+别名+关系+证据原文）→ petgraph 建图；检索用 2-3 跳受限遍历替代完整 PPR（百节点规模效果等价，成本低一个量级） | github.com/OSU-NLP-Group/HippoRAG（v2: ICML'25）；petgraph 内置 BFS/page_rank |
| 数据模型 = Longform 式「md 文件真源 + 索引」 | github.com/kevboh/longform（952★） |
| 伏笔追踪参考 ainovel-cli 的四维度章节推荐 | github.com/voocel/ainovel-cli（2k★） |
| 图谱可视化用 Cytoscape.js（内置 fcose 布局+图算法，百节点开箱即用） | 对比 React Flow/Sigma.js 后的选型 |
| Rust crate 清单：rusqlite(bundled)+rusqlite_migration、serde/serde_json、thiserror、jieba-rs（M2）、async-openai（M1，OpenAI 兼容网关通吃国内主流+中转）、petgraph（M2）、fastembed+usearch（Backlog） | crates.io 2026-09 活跃度核实 |
| 架构参考项目：Spacedrive（Tauri+React+Rust 数据层）、思源笔记（双链/图谱产品设计）、pot-desktop（中文 Tauri 打包发布） | 均活跃 |

**竞品确认的空白**（笔仙差异化）：①「人写为主」工具中无人物图谱自动抽取+双链跳转；②伏笔标注+回收次数面板开源零实现；③灵感碰撞器（N 词随机组合成卡）零实现；④Rust 本地优先桌面写作工具近乎为零。同赛道风险项：vela、Biz Novel Studio、91Writing（均 Electron/Python，快速迭代中）。

## 2. Non-goals（明确不做）

- 不做 Claude Code/多 CLI 引擎封装（desktop-cc-gui 已做，笔仙直连 LLM API）
- 不做云同步、多人协作、移动端、插件系统（后置 Backlog）
- 不做全自动 agent 小说流水线（autonovel/ainovel-cli 已做）
- M1 不做本地嵌入向量检索（关键词触发+图遍历够用；fastembed 升级路径保留）
- 不自研富文本编辑器（Zed/Lapce 教训）

## 3. 总体架构

```
┌─ Tauri 2 WebView ─ React 18 + TS + Tailwind 4 + Zustand ──────────────┐
│ 三栏布局（仿 desktop-cc-gui）：                                        │
│   左：书籍/章节树（可折叠拖宽）                                        │
│   中：TipTap 编辑器 + 顶部章节栏 + 底部状态条 + AI 流式输出区(M1)        │
│   右：面板 Dock 多标签：大纲 | 人物图谱 | 伏笔 | 碰碰车（M2-M4 逐个点亮）│
└───────────────┬─────────────────────────────────────────┘
        invoke commands（JSON-RPC，请求/响应）
        emit events（流式：stream://<chapter_id> 等，M1 起）
┌───────────────┴──── Rust core (src-tauri/src) ────────────┐
│ commands.rs   薄命令层（参数校验+组合下层）                    │
│ state.rs      AppState { db: Mutex<Connection>, root }      │
│ repo/         books / chapters（及 M2+ 的 entities 等）       │
│ fs_service    library/ 目录下 md 文件读写、扫描               │
│ db.rs         迁移与连接                                      │
│ llm/ (M1)     async-openai 流式、ContextAssembler 上下文组装   │
│ graph/ (M2)   抽取管线、petgraph、注入触发器                    │
│ muse/ (M4)    碰碰车随机组合、灵感卡                            │
└───────────────────────────────────────────┘
```

**数据流铁律**：章节正文以磁盘 md 文件为唯一真源；SQLite 只存元数据与派生数据（图谱、伏笔、卡片、会话），任何时候可通过 `rescan_library` 从文件重建 books/chapters 索引；前端不直接碰文件系统。

## 4. 数据模型

### 4.1 磁盘布局（app_data_dir = %APPDATA%/com.bixian.app）

```
bixian.db                      SQLite
library/
  <slug>/
    book.json                  {"title": "书名"}
    manuscript/
      0001-初见.md             纯正文 markdown（无 frontmatter；标题在文件名与 DB）
      0002-风波.md
```

- slug：书名经 slugify（保留 [A-Za-z0-9] 与 CJK，其余转连字符），目录冲突时追加 `-2`、`-3`
- 章节文件名：`{4位序号}-{章节标题slug}.md`；序号仅作文件排序，真实排序用 DB 的 sort_key
- 章节标题含非法文件名字符时由 slugify 清洗

### 4.2 SQLite Schema

M0（本次实施）：

```sql
CREATE TABLE books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,          -- 相对 library/，如 "mybook/manuscript/0001-chu-jian.md"
  title TEXT NOT NULL,
  sort_key REAL NOT NULL,           -- 分数排序（M3 拖拽用中值插入，免全表重写）
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(book_id, file_path)
);
```

前瞻（M1-M4 实施时再加迁移，字段供后续计划对齐，不在 M0 建）：

```sql
-- M1
settings(key TEXT PRIMARY KEY, value TEXT);                    -- provider 档案 JSON、当前文风等
styles(id, name, prompt_md, sample_md, tags_json, created_at, updated_at); -- 文风卡（全局）
sessions(id, book_id, chapter_id, kind, created_at);           -- kind: continue|rewrite|chat
messages(id, session_id, role, content, created_at);
-- M2
entities(id, book_id, canonical_name, etype, aliases_json, meta_json,
         card_md, card_enabled, constant_inject, insertion_order, keywords_json,
         created_at, updated_at);                              -- etype: person|place|item|setting
relations(id, book_id, source_id, target_id, label,
          evidence_json, updated_at);                          -- evidence: [{chapter_id, quote}]
-- M3
foreshadows(id, book_id, title, note, planted_chapter_id,
            recall_count, resolved, created_at);
foreshadow_marks 存于章节 md 的 TipTap mark（attrs: fs_id），不入表
-- M4
inspiration_words(id, scope, word, created_at);                -- scope: global|book:<id>
inspiration_cards(id, book_id NULL, words_json, content_md, created_at);
plot_blocks(id, book_id NULL, title, content_md, tags_json, use_count, created_at, updated_at);
```

### 4.3 词数统计规则（中英文混排）

CJK 字符（含扩展 A/B、兼容区）每字计 1；连续 ASCII 字母/数字串计 1。Rust 与前端各实现一份，测试用例对齐。

### 4.4 注入原子统一模型（原子化设计核心）

凡可注入 ContextAssembler 的素材 = **注入原子**。五类：

| 原子 | 载体表 | 注入槽位 | 触发方式 |
|---|---|---|---|
| 文风卡 | styles（M1） | 1 system | 手动选用（每书一个激活位） |
| 角色卡 | entities 卡面（M2） | 3 | 关键词命中当前场景（ST 式）+ constant |
| 伏笔 | foreshadows（M3） | 4 | 未回收自动列出（相关过滤）+ 时效提醒 |
| 灵感卡 | inspiration_cards（M4） | 4 尾部 | 手动勾选 |
| 情节块 | plot_blocks（M4） | 4 尾部 | 手动勾选（伏笔回收方案可挂载） |

统一存储模式：`{id, book_id（可空=全局）, title, content_md, meta/tags, created_at, updated_at}`（角色卡挂载于实体行，字段对齐本模式）。**只统一存储与注入接口；各类型的触发语义独立实现，不做万能卡片抽象。**

**可见性要求**：所有注入必须经上下文预览面板（见 F1）可见，黑盒注入视为缺陷。

## 5. 功能规格

### F1 AI 写作主体（M1）

- **Provider 档案**：`{name, base_url, api_key, model, max_tokens, temperature}`，支持多档案切换；OpenAI 兼容协议（DeepSeek/Kimi/通义/OpenRouter/中转站通吃）。api_key M1 明文存 settings 表（单机本地可接受），Backlog 换 OS keyring。
- **会话模型**：每章节多个 AI 会话（续写/改写/自由对话），消息持久化于 sessions/messages；界面仿 desktop-cc-gui 消息流（流式逐帧揭示、可折叠）。
- **流式事件协议**：Rust 侧 `enum StreamEvent { Delta(String), Done { usage }, Error(String) }`，经 `emit("stream://{session_id}", event)` 推前端；SSE 解析在 Rust（async-openai stream）。
- **文风库（M1）**：文风卡 `{name, prompt_md（风格指令）, sample_md（样章）, tags[]}`，全局不挂书。样章用于预览「该文风写出来的样子」；支持导入现有文风 Claude skill（markdown 正文 → prompt_md）与导出分享；每书一个激活文风（记于 settings），续写一键切换，注入槽位 1。
- **上下文预览面板（组装日志，M1 起一等公民）**：每次组装可展开各槽位摘要——命中了哪张文风卡/角色卡/哪些伏笔、各段 token 占用。原子注入必须可见、可验证。
- **ContextAssembler（核心抽象，M1 简版，M2/M3 扩展槽位）**，组装顺序固定：
  1. system：文风卡（文风库当前选用，可无）+ 书级设定（book.json 可扩 settings 字段）
  2. 大纲：当前卷/章大纲要点（M3 前：无）
  3. 角色卡：触发命中的实体卡（M2 前：无）
  4. 伏笔提醒：相关未回收伏笔清单（M3 前：无）
  5. 前文：当前章节已写正文 + 上一章尾部（滑窗，预算内截断）
  6. 用户本次指令
- **操作**：续写（尾部追加）、改写（选区替换，M1.5）、自由对话。所有输出可一键采纳进正文或放弃。

### F2 人物图谱（M2）

- **抽取管线**：章节保存后后台异步抽取（不阻塞写作）。LLM 参数 `temperature=0` + JSON Schema strict 输出。Prompt 草案（中文，执行时可微调）：

  > 你是小说设定编辑。以下是《{书名}》第{n}章正文，以及书中已知人物清单（规范名：别名）。
  > 1. 找出本章出场/被提及的人物（含新人物），为每个人物给出：规范名（已知人物必须用清单中的规范名）、本章新出现的别名、一句话特征描述。
  > 2. 找出本章人物两两之间的关系（师徒/敌对/亲属/暗恋…），每条关系附正文原句作证据。
  > 已知人物清单：{entities}。正文：{chapter_text}
  > 严格输出 JSON：{"persons":[{"name":"...","aliases":["..."],"description":"..."}],"relations":[{"source":"...","target":"...","relation":"...","evidence":"..."}]}。无则输出空数组。source/target 必须来自 persons。

- **消歧**：已知实体清单（规范名+别名）注入 prompt 让 LLM 对齐；名称完全包含/别名命中直接归并；同名新实体由用户在图谱面板手动合并。
- **增量更新**：章节重抽时按 evidence diff 合并——新增关系加边；某关系的全部证据章节被删才删边。边权 = 证据条数（共现强度）。
- **检索（简化 HippoRAG）**：续写时取当前场景命中的实体为种子，petgraph 上 2 跳 BFS 按边权 top-k 取相关实体，其卡片与近三章相关证据进入 ContextAssembler 第 3 槽。不做完整 PPR。
- **角色卡字段**（CCv2 子集 + meta）：`canonical_name / aliases[] / etype / description(小传) / personality / scenario / keywords[](默认=name+aliases，可加) / constant_inject / insertion_order / meta(自由 kv，类 Obsidian frontmatter，如 年龄/阵营/外貌)`。注入触发 = ST 式：keywords 命中当前场景文本 → 按 insertion_order 注入 → token_budget 裁剪 → constant 卡恒注入。
- **UI**：右面板 Cytoscape.js（fcose 布局，边权为粗细），节点点击→实体详情页（卡编辑、出场章节列表、关系列表）；出场章节列表由 FTS5+jieba 检索（M2 引入：章节保存时 jieba 预分词写入 FTS 表）。
- **双链**：正文中实体名（经分词识别或用户选中）可包裹为 entity mark，点击跳转实体页；实体页反向列出所有出现位置。

### F3 素材系统：碰碰车 + 灵感卡 + 情节块（M4）

- 碰碰车：词池全局池 + 每书独立池，CRUD；抽取数 n 可调（2-5），一次抽 1-3 组不重复组合；结果视图大字展示词组 + 「让 AI 碰一下」按钮（调 F1 provider 流式生成 100 字内联想桥接）。
- 灵感卡：`{words[], content_md, created}` 保存入库；续写时可勾选注入 ContextAssembler（进第 4 槽尾部）。
- 快速捕获：侧栏常驻输入框 + 全局快捷键，不经碰碰车零摩擦直入灵感卡库（words 为空，content 为捕获文本）。
- 情节块：`{title, content_md, tags[], use_count}` 可复用桥段原子（金蝉脱壳/雨夜重逢…）；手动勾选注入第 4 槽尾部；伏笔回收时可挂载情节块作为回收方案；记录使用次数。

### F4 大纲 + 伏笔面板（M3）

- **大纲**：卷/章两级树（M3 先做章级平铺+分组），拖拽重排 = sort_key 中值插入法；节点显示字数与状态色点。
- **伏笔**：编辑器内联 TipTap custom mark `foreshadow`（attrs: fs_id）；标记时侧栏登记 `{title, note, planted_chapter_id}`。面板列全部伏笔：状态（未回收/已回收）、recall_count（正文中再次以同 fs_id 标注即 +1，或面板手动 +1）。ContextAssembler 第 4 槽注入「未回收伏笔提醒」。时效提醒（草蛇灰线不失线）：面板按「埋设章节距当前写作章节的距离」渐变标色（如 >10 章未回收标黄、>20 章标红）。

## 6. 里程碑路线图

| 里程碑 | 范围 | 验收标准 | 计划文档 |
|---|---|---|---|
| **M0 基础骨架** | 脚手架、DB、文件服务、命令层、三栏布局、TipTap 编辑+自动保存、rescan | 建书/建章/编辑/自动保存/重启不丢/打包 exe 可跑 | 2026-09-19-m0-foundation.md（已写） |
| M1 AI 写作 | Provider 档案、流式会话、ContextAssembler、文风库（含 skill 导入）、上下文预览面板、消息流 UI | 配置 provider 后流式续写逐字可见；可导入文风 skill 并切换生效；组装日志可见各槽注入与 token 占用；会话历史持久 | M0 完成后撰写 |
| M2 人物图谱 | 抽取管线、entities/relations、Cytoscape 面板、实体页、角色卡注入、FTS 检索、双链 | 保存章节自动出图谱；点节点跳实体页；写含已抽取角色的场景时组装日志可见卡片注入 | M1 完成后撰写 |
| M3 大纲+伏笔 | 大纲树拖拽、foreshadow mark、伏笔面板与计数、时效渐变提醒、注入第 4 槽 | 拖拽重排持久化；伏笔标注/回收计数/未回收提醒注入/超期伏笔标色 | M2 完成后撰写 |
| M4 素材系统 | 碰碰车（词池/随机组合/AI 联想）、灵感卡、快速捕获、情节块、注入 | 碰碰车全流程可用；灵感零摩擦捕获成卡；情节块勾选注入且使用计数正确 | M3 完成后撰写 |

Backlog（不做承诺）：OS keyring 存密钥、SillyTavern PNG 角色卡导入、fastembed 本地语义检索、epub 导出、自动更新（pot-desktop 方案）、卷级分组。

## 7. 风险与对策

| 风险 | 对策 |
|---|---|
| TipTap v3 与 tiptap-markdown 兼容不确定 | 全家桶锁定 v2.26.x；升级 v3 是独立任务 |
| LLM 结构化输出偶发失败 | strict json schema + 同参数重试 1 次 + 降级跳过并在图谱面板标记该章抽取失败可手动重试 |
| 长书（500+ 章）侧栏/图谱性能 | 侧栏虚拟滚动（@tanstack/react-virtual）；图谱按卷/章过滤 |
| SQLite FTS5 中文分词 | jieba-rs 预分词、空格连接写入 FTS 列（unicode61 tokenizer 按空格切） |
| WebView2 中文 IME | M0 编辑器任务内置手动 IME 验证步骤，发现丢字立即上报换方案 |
| 抽取消耗 token | 默认仅手动触发「本章抽取」+ 可选「保存后自动」开关 |
| 文风 skill 格式多样 | 导入仅接受 markdown 正文（SKILL.md 取正文段落）；复杂格式手动粘贴 |

## 8. 术语表

- **真源**：章节正文只认磁盘 md 文件；DB 中 chapters 行只是索引
- **注入原子**：可注入 ContextAssembler 的素材统称（文风卡/角色卡/伏笔/灵感卡/情节块），统一存储模式见 §4.4
- **角色卡**：实体的提示词注入单元（F2 字段集）
- **文风卡**：{风格指令, 样章}，注入槽位 1，支持从 Claude skill markdown 导入
- **情节块**：可复用桥段原子，手动勾选注入
- **灵感卡**：碰碰车或快速捕获产出的可复用组合卡
- **种子实体**：当前场景命中的实体，图遍历起点
- **组装日志（上下文预览面板）**：ContextAssembler 每次组装的槽位摘要与 token 占用（验证原子注入）
