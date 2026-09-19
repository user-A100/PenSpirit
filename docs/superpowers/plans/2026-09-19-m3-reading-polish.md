# 笔仙 M3 阅读模式 + 主题质感 + 统计增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 笔仙获得：① 独立阅读模式（books-reader 同款四边面板/边缘热区/调整面板/进度记忆）；② 应用级纸张纹理系统（Maple 机制 + feTurbulence 内置纹理）；③ 右侧 dock 收缩；④ 碰碰车智能批量加词；⑤ token-meter 式写作统计（连续天数/热力图/日目标/每书进度）；⑥ 伏笔面板（webnovel-writer 紧急度模型）；⑦ 编辑器中文排版细节（首行缩进/分场符）。

**Architecture:** 前端为主：阅读模式注册为一级视图（navRegistry），四边面板 + 热区自建组件；纹理 = App 根挂全屏 pointer-events-none 覆盖层（Maple alpha 叠加思路的简化版）；统计图表全部手绘 SVG 零依赖。Rust 侧仅补数据层：迁移 0007（books.target_words + foreshadows 表）、通用 setting_get/set、stats_range、阅读背景图 fs 命令、伏笔 CRUD。

**Tech Stack:** 零新增依赖（npm 与 cargo 均不新增——图表手绘 SVG、取色用原生 input[type=color]、纹理用内联 SVG data URI）。其余沿用 M0-M2 栈。

**Spec:** `docs/specs/2026-09-19-bixian-spec.md`。四份调研结论已内联本计划；参考仓库（只读，勿改）在 `D:\Mycraft\research\`：books-reader、maple、token-meter-repo、webnovel-writer。

## Global Constraints

- 沿用 M0-M2 全部约束：Tauri 2.x、返回结构体 snake_case、命令参数 JS camelCase、文案中文、每任务三件套（cargo test / pnpm test / pnpm build）全绿才提交、commit 规范（`feat: 中文标题`）
- **零新增依赖铁律**：不新增任何 npm / cargo 包。图表 = 手绘 SVG；取色器 = 原生 `<input type="color">`；纹理 = 内联 SVG data URI（几百字节，安全）
- **WebView2 铁律**（books-reader 血泪教训，`research/books-reader/src/utils/file/backgroundUtil.ts:24`）：**禁止把大 data-URL 塞进 CSSOM**（WebView2 静默丢弃数 MB 内联样式值）。背景图一律走 `convertFileSrc()` asset 协议
- 阅读偏好/面板锁定/大纲位置 = localStorage（同步无闪烁）；**阅读进度 = Rust settings KV**（用户数据随 db 备份）
- md 文件唯一真源不变；`.trash/`、`.history/`、`background/`（新增）均为库内/应用数据目录，不参与扫描
- 原计划「人物图谱」顺延 M4（本次 M3 范围为用户六点需求 + 伏笔面板）

---

### Task M3-T1: Rust 数据层——迁移 0007 + 通用设置 + 统计查询

**Files:**
- Create: `src-tauri/migrations/0007_m3.sql`、`src-tauri/tests/m3_data_test.rs`
- Modify: `src-tauri/src/db.rs`（注册 0007）、`src-tauri/src/models.rs`（Book.target_words、Foreshadow、DailyStat、ForeshadowInput）、`src-tauri/src/repo/books.rs`（COLS + set_target）、`src-tauri/src/repo/mod.rs`（+foreshadows）、`src-tauri/src/repo/foreshadows.rs`（新）、`src-tauri/src/commands.rs`、`src-tauri/src/lib.rs`、`src/lib/tauri.ts`（api 追加）、`src/stores/settings.ts`（不动——通用 KV 走新封装 `src/lib/kv.ts` 放 T4 用，本任务只加 api）

**迁移 0007_m3.sql：**
```sql
-- M3：完本目标 + 伏笔登记
ALTER TABLE books ADD COLUMN target_words INTEGER;
CREATE TABLE foreshadows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  planted_chapter_id INTEGER NOT NULL,   -- 埋设章（chapters.id，序号由前端按列表序解析）
  target_chapter_id INTEGER,             -- 计划回收章（NULL=未定）
  status TEXT NOT NULL DEFAULT 'active', -- active | resolved | dropped
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_chapter_id INTEGER
);
```

**Interfaces（Rust，本任务产出、T9/T10/T4 消费）：**
```rust
// models.rs
pub struct Foreshadow { pub id: i64, pub book_id: i64, pub title: String,
  pub planted_chapter_id: i64, pub target_chapter_id: Option<i64>,
  pub status: String, pub note: String, pub created_at: String,
  pub resolved_chapter_id: Option<i64> }
pub struct ForeshadowInput { pub id: Option<i64>, pub book_id: i64, pub title: String,
  pub planted_chapter_id: i64, pub target_chapter_id: Option<i64>, pub note: String }
pub struct DailyStat { pub date: String, pub words: i64, pub active_minutes: i64 }

// commands.rs（全部薄包装，inner 可测）
setting_get(key) -> Option<String>            // repo::settings::get 直通
setting_set(key, value) -> ()                 // upsert
stats_range(days: u32, book_id: Option<i64>) -> Vec<DailyStat>
  // book_id=None: SELECT date, SUM(words), SUM(active_minutes) FROM writing_stats
  //   WHERE date >= date('now','localtime', printf('-%d days', ?1)) GROUP BY date ORDER BY date
  // book_id=Some: 同上加 AND book_id=?，ORDER BY date
books_set_target(book_id, target_words: Option<i64>) -> Book   // repo::books::set_target
foreshadows_list(book_id) -> Vec<Foreshadow>                   // ORDER BY id
foreshadow_upsert(input: ForeshadowInput) -> Foreshadow        // id=None 插入；Some 更新（校验归属）
foreshadow_set_status(id, status: String, resolved_chapter_id: Option<i64>) -> Foreshadow
  // status 仅允许 active|resolved|dropped（否则 Invalid）；resolved 时 resolved_chapter_id 必填
foreshadow_delete(id) -> ()
```

**tauri.ts 追加：**
```ts
export interface Foreshadow { id: number; book_id: number; title: string;
  planted_chapter_id: number; target_chapter_id: number | null; status: string;
  note: string; created_at: string; resolved_chapter_id: number | null }
export interface ForeshadowInput { id?: number | null; book_id: number; title: string;
  planted_chapter_id: number; target_chapter_id?: number | null; note: string }
export interface DailyStat { date: string; words: number; active_minutes: number }
// api 对象追加：
settingGet: (key: string) => invoke<string | null>("setting_get", { key }),
settingSet: (key: string, value: string) => invoke<void>("setting_set", { key, value }),
statsRange: (days: number, bookId: number | null) => invoke<DailyStat[]>("stats_range", { days, bookId }),
booksSetTarget: (bookId: number, targetWords: number | null) => invoke<Book>("books_set_target", { bookId, targetWords }),
foreshadowsList: (bookId: number) => invoke<Foreshadow[]>("foreshadows_list", { bookId }),
foreshadowUpsert: (input: ForeshadowInput) => invoke<Foreshadow>("foreshadow_upsert", { input }),
foreshadowSetStatus: (id: number, status: string, resolvedChapterId: number | null) =>
  invoke<Foreshadow>("foreshadow_set_status", { id, status, resolvedChapterId }),
foreshadowDelete: (id: number) => invoke<void>("foreshadow_delete", { id }),
```
Book 接口加 `target_words: number | null`（serde default 已有惯例，注意 repo COLS 同步 + from_row）。

- [ ] Step 1: 失败测试 `tests/m3_data_test.rs`：setting_get/set 往返与覆盖；stats_range 空/跨书聚合/单书过滤（insert 写作统计后按日聚合断言）；books_set_target 设/清（NULL）；伏笔 CRUD 全链（list 空→upsert 插入→list 1→set_status resolved 带 resolved_chapter_id→非法 status 报 Invalid→upsert 更新→delete→级联：删书后 foreshadows_list 空）→ 实现 → 绿
- [ ] Step 2: lib.rs 注册 10 个命令；三件套绿 → Commit `feat: M3 数据层——目标字数/伏笔表/通用设置/统计查询`

### Task M3-T2: 右侧 dock 收缩

**Files:**
- Modify: `src/lib/nav/uiStore.ts`（dockCollapsed + toggleDock + DOCK_PCT_KEY/loadDockPct/saveDockPct，全部镜像 sidebar 既有实现）、`src/views/WriteView.tsx`（dock Panel 加 collapsible/collapsedSize="0"/panelRef/onResize 记忆，逻辑照抄 sidebar Panel 78-101 行）、`src/components/layout/PanelDock.tsx`（tab 栏右端加 PanelRightClose/PanelRightOpen 图标按钮）、`src/App.tsx`（Ctrl+\ 全局快捷键）、`src/lib/nav/uiStore.test.ts`

**Interfaces:** `useUiNav` 新增 `dockCollapsed: boolean; toggleDock(): void`（会话内状态）；`loadDockPct()/saveDockPct(pct)` 与 sidebar 同构（key `bixian.nav.dockPct`，有效域 17-34）。

**要点：** WriteView 的 dock Panel 复制 sidebar Panel 的全部手法：collapsible + collapsedSize="0"、折叠期间 `data-rail-animating` 补间、onResize 首帧跳过/宽度 0 不记忆/拖出单向同步 store、Separator 与左边框随折叠隐藏。折叠态 PanelDock 不渲染内容只渲染 0 宽（内容卸载由 `{!dockCollapsed && <PanelDock/>}` 控制，同 sidebar）。快捷键 Ctrl+\（App.tsx，与 Ctrl+B 并排）。

- [ ] Step 1: 失败测试（toggleDock 翻转；loadDockPct 非法值回 null）→ 实现 uiStore → 绿
- [ ] Step 2: WriteView/PanelDock/App 改造 → 三件套绿 → Commit `feat: 右侧 dock 收缩——Ctrl+\ / 记忆宽度 / 补间动画`

### Task M3-T3: 纸张纹理系统（Maple 机制 + 内置 SVG 纹理）

**Files:**
- Create: `src/themes/textures.ts`、`src/themes/textures.test.ts`
- Modify: `src/themes/ThemeProvider.tsx`（AppearanceSettings.texture + applyTexture + normalizeAppearance 兼容旧数据）、`src/themes/defs.ts`（不动变量表）、`src/styles.css`（#texture-layer 样式）、`src/components/settings/AppearancePane.tsx`（「纸张纹理」区）、`src/App.tsx`（挂覆盖层）、`src/themes/themes.test.ts`（normalize 新分支）

**Interfaces:**
```ts
// src/themes/textures.ts
export type TexturePresetId = "none" | "paper" | "dots" | "grid" | "ruled" | "canvas";
export interface TextureDef { id: TexturePresetId; name: string; css: string } // css = background-image 值
export const TEXTURES: TextureDef[]; // 六项，css 均为内联 SVG data URI 或 gradient
export function findTexture(id: string): TextureDef | undefined;
// paper（feTurbulence fractalNoise baseFrequency=0.9 双八度 + feColorMatrix 压成半透明灰）：
//   url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")
// canvas：同款但 baseFrequency=0.04 numOctaves=4（织物大颗粒）；dots：radial-gradient(circle, rgba(128,128,128,.35) 1px, transparent 1px)
// grid：双向 1px linear-gradient（Maple bg.scss 手法）；ruled：单向横线（稿纸）
// ThemeProvider 内：
export interface TextureSettings { preset: TexturePresetId; opacity: number; scale: number; blend: "normal"|"multiply"|"overlay"|"soft-light" }
// AppearanceSettings += texture: TextureSettings（默认 {preset:"none", opacity:0.12, scale:1, blend:"soft-light"}）
export function applyTexture(t: TextureSettings): void  // 切 html[data-texture] 属性 + 更新 #texture-layer 的 CSS 变量
```

**实现要点：** 覆盖层放 App 根（Ribbon 之外全屏之上）：`<div id="texture-layer" aria-hidden className="pointer-events-none fixed inset-0 z-[200]" style={{ backgroundImage, backgroundSize: `${240*scale}px`, opacity, mixBlendMode: blend }}/>`。z-200 高于全部面板/弹窗 → 纹理均匀铺满整个应用（Maple「整页纸感」取向）；opacity 常用域 0.06-0.25（AppearancePane 滑条 0-0.4 step 0.02），blend 默认 soft-light（深浅主题通吃）。normalizeAppearance 必须兼容无 texture 字段的旧 localStorage（回默认值）——已有测试模式照抄。纹理区 UI：预设六选 chips（含「无」）+ 三滑条（强度/缩放 0.5-3/混合模式四选 select），选「无」时参数区隐藏（Maple 条件显隐约定）。

- [ ] Step 1: 失败测试（TEXTURES 六项 css 非空且 none 为空串；findTexture；normalizeAppearance 旧数据无 texture 字段回默认、非法 preset 回 none；opacity 越界 clamp）→ 实现 → 绿
- [ ] Step 2: App 覆盖层 + AppearancePane 纹理区 → 三件套绿 → Commit `feat: 纸张纹理——六种内置 SVG 纹理/强度缩放混合可调`

### Task M3-T4: 阅读模式核心——ReadView + 进度记忆 + 章导航

**Files:**
- Create: `src/views/read/ReadView.tsx`、`src/views/read/readingPrefs.ts`（prefs store + 类型 + localStorage）、`src/views/read/readingPrefs.test.ts`、`src/lib/kv.ts`（settingGet/Set 的极薄 async 封装 + JSON helper）、`src/lib/kv.test.ts`
- Modify: `src/lib/nav/registry.ts`（注册 read 视图）、`src/lib/nav/uiStore.ts`（readReturn: string | null + setReadReturn）、`src/App.tsx`（渲染 read 视图，条件渲染不常挂）

**Interfaces:**
```ts
// readingPrefs.ts —— localStorage key "bixian.reading"（同步读，避免进入闪烁）
export interface ReadingPrefs {
  fontSize: number;        // 13-40，默认 17（books-reader 同域）
  lineHeight: number;      // 1 | 1.25 | 1.5 | 1.75 | 2，默认 1.75
  letterSpacing: number;   // 0-2 step 0.1，默认 0
  paraSpacing: number;     // 0-3 step 0.1（em），默认 0.6
  pageWidth: number;       // 480-1000 step 20，默认 720
  margin: number;          // 0-96 step 8（px 额外页边），默认 0
  fontFamily: string;      // "" = 默认衬线栈；"kai"/"song"/"hei" 预设映射
  textAlign: "left" | "justify";   // 默认 justify（中文书版惯例）
  indent: boolean;         // 首行缩进 2em，默认 true
  bgColor: string;         // 默认 "#f5eddd"（米黄，books 预设 3）
  textColor: string;       // 默认 "#3b3227"
  bgImage: { id: string; path: string } | null;  // T6 接入，先留字段
  bgOpacity: number;       // 0-100 图片不透明度，默认 78（books 同默认）
}
export const READING_BG_PRESETS: { bg: string; text: string; name: string }[]
  // [白/黑字, 暗夜/白字, 米黄/棕字, 护眼绿/墨绿字] —— books-reader 四预设同值
export function normalizeReadingPrefs(raw: unknown): ReadingPrefs;  // 逐字段 clamp/回默认
export const useReadingPrefs = create<...>();  // set(partial) 合并 + 落盘（无防抖——滑条 change 频率可接受，与 uiScale 一致性留 T6 优化）

// kv.ts
export const kvGet = async <T>(key: string): Promise<T | null> => …  // settingGet + JSON.parse，坏值 null
export const kvSet = async (key: string, value: unknown): Promise<void> = …
```

**ReadView 要点：**
- 注册：`registerView({ id: "read", label: "阅读", icon: BookOpen, Component: ReadView, dockPanels: [] })`；进入时 uiStore.setReadReturn(进入前 activeView)，Esc/退出按钮 → setView(readReturn ?? "write")
- 内容：TipTap 只读实例（StarterKit+Markdown，`editable: false`），数据直接用 workspace store 的 chapters/chapterContent（与写作视图同源）；无当前章 → 居中空态「在写作视图选择章节后进入阅读」+ 返回按钮
- 排版：容器 style 注入 prefs（fontSize px、lineHeight、letterSpacing em、段落 marginBottom em、maxWidth pageWidth、textAlign、text-indent、fontFamily 映射：kai→"KaiTi,STKaiti,serif" 等）；正文复用 .prose-serif 色由 textColor 内联覆盖
- **进度记忆**：滚动容器 onScroll → ratio = scrollTop/(scrollHeight-clientHeight)（0-1，高度为 0 时记 0）→ 300ms 防抖 kvSet(`read:progress:{bookId}`, { chapter_id, scroll_ratio, ts })；进入时 kvGet → 有记录且章存在 → selectChapter(chapter_id)，chapterContent 就位后（effect 依赖 chapterContent）一次 scrollTo(ratio*scrollHeight)（消费后清标志 ref，避免后续切换章误跳）
- 章导航：chapters 数组序 prev/next（Ctrl+←/→）；右下角悬浮圆钮组（上一章/下一章/退出）——进入时强制显示 1.5s 后淡出（books-reader 手法），鼠标进入按钮区恢复
- 键盘：Esc 退出；↑↓/PageUp/PageDown 原生滚动；Ctrl+←/→ 换章。ReadView 挂载时绑定、卸载解绑
- 阅读时长：进入时刻记 ref，T5 的顶栏消费

- [ ] Step 1: 失败测试（normalizeReadingPrefs 全字段非法回默认/clamp；kv 封装 mock invoke 测 JSON 往返与坏值）→ 实现 → 绿
- [ ] Step 2: ReadView + registry + uiStore.readReturn + App 接线 → 三件套绿 → Commit `feat: 阅读模式核心——只读视图/排版 prefs/进度记忆/章导航`

### Task M3-T5: 阅读四边面板——热区唤出 + 锁定 + 目录/信息/进度

**Files:**
- Create: `src/views/read/ReadingShell.tsx`（面板调度 + 热区 + 锁定）、`src/views/read/readingPanels.ts`（store）、`src/views/read/readingPanels.test.ts`、`src/views/read/NavPanel.tsx`（左：目录）、`src/views/read/TopPanel.tsx`、`src/views/read/BottomPanel.tsx`
- Modify: `src/views/read/ReadView.tsx`（正文包进 ReadingShell）、`src/styles.css`（面板滑入滑出/热区样式）

**Interfaces:**
```ts
// readingPanels.ts
export type PanelPos = "left" | "right" | "top" | "bottom";
interface ReadingPanelsState {
  left: boolean; right: boolean; top: boolean; bottom: boolean;
  navLocked: boolean; settingLocked: boolean;   // 锁定持久化 localStorage "bixian.reading.locks"
  open: (p: PanelPos) => void; close: (p: PanelPos) => void; toggle: (p: PanelPos) => void;
  setNavLocked: (v: boolean) => void; setSettingLocked: (v: boolean) => void;
}
```

**要点（books-reader 机制照搬，`research/books-reader/src/pages/reader/component.tsx:40-414`）：**
- **热区**：四边绝对定位 div（40px 宽/高、40% 居中长、opacity 0→0.5 hover）；onMouseEnter → 500ms 延迟且要求鼠标静止（100ms 移动检测，isMouseMoving ref）才 open；面板 onMouseLeave → 500ms 后 close；计时器 id 存 ref，enter/leave 互相 clear。设置面板内 input 聚焦时禁止右面板收回（focus/blur 事件置 ref，books 同款）
- **面板**：left/right 299px 全高、top/bottom 450×60px；隐藏变换 translateX/Y(±309/110px)，`transition: transform 0.5s ease`（books 同参数）；内容入场 fade 方向 keyframes 0.2s。常量 `READ_PANEL_W = 299` 收敛为一个 CSS 变量 `--read-panel-w`
- **锁定**：左/右面板角上锁图标；锁定 = 常驻 + 正文容器 padding 让位（locked left → paddingLeft: var(--read-panel-w)，对偶同理；顶/底锁定 → marginTop/Bottom 60px）。点击正文关闭全部未锁定面板
- **快捷键**：F6/F7/F8/F9 开合左/右/上/下面板（ReadView 内绑定，CustomEvent 方案不需要——直接调 store）
- **NavPanel（左）**：书名 + 目录树（chapters 平铺 + 当前章 accent 高亮 + 目录滚动到当前章 scrollIntoView）+ 目录内过滤输入框（标题子串，不区分大小写）+ 底部「本书 N 章」；点击项 → selectChapter
- **TopPanel（上）**：书名/章名、本次阅读时长（mm:ss，1s interval，从 ReadView 传入 startedAt）、进度百分比、退出按钮（调退出逻辑）+ 全屏切换（document.documentElement.requestFullscreen/exitFullscreen）
- **BottomPanel（下）**：进度滑条（value = 当前章序/总章数，change → selectChapter 对应章）、「第 X / N 章」标签、上一章/下一章按钮
- 章末提示：滚动到底时正文底部显示「下一章：{title} →」可点击按钮（books scrollChapter 语义）

- [ ] Step 1: 失败测试（store open/close/toggle/锁存取与持久化恢复；NavPanel 渲染目录+过滤+当前章高亮；BottomPanel 滑条换章回调）→ 实现 → 绿
- [ ] Step 2: ReadingShell 热区/锁定/动画 + 三面板接线 → 三件套绿 → Commit `feat: 阅读四边面板——热区延迟唤出/锁定/目录/进度条`

### Task M3-T6: 阅读调整面板 + 背景图 + 设置搜索

**Files:**
- Create: `src/views/read/SettingPanel.tsx`、`src/views/read/readerBg.ts`（hexToRgba + 背景样式合成 + Rust 命令封装）、`src/views/read/readerBg.test.ts`、`src/views/read/SettingPanel.test.tsx`
- Modify: `src-tauri/src/commands.rs` + `lib.rs`（reading_bg_* 三命令）、`src-tauri/tauri.conf.json`（assetProtocol）、`src/views/read/ReadView.tsx`（背景应用）、`src/views/read/ReadingShell.tsx`（右面板挂 SettingPanel）、`src/lib/tauri.ts`（BgImage 类型 + api 三方法）

**Interfaces：**
```rust
// commands.rs —— 背景图存 {appData}/background/（s.root 的上级目录），id = 纳秒时间戳 hex
pub struct BgImage { pub id: String, pub path: String, pub name: String }
reading_bg_import(src_path: String) -> BgImage   // 校验扩展 png/jpg/jpeg/webp/gif + ≤10MB；拷贝入库；重复导入直接多存一份（列表可删）
reading_bg_list() -> Vec<BgImage>                // 扫描目录 + 文件名还原 name；目录缺失回空
reading_bg_delete(id: String) -> ()              // 删文件；prefs 引用由前端在选择时校验
```
```ts
// readerBg.ts
export function hexToRgba(hex: string, alpha: number): string;  // "#rrggbb"+0-1 → "rgba(r,g,b,a)"；非法 hex 回 "rgba(0,0,0,0)"
export function readingBgStyle(p: ReadingPrefs): CSSProperties;
  // bgImage 存在：backgroundColor: bgColor；backgroundImage: `linear-gradient(${hexToRgba(bgColor, 1-opacity)}, ${同}), url(${convertFileSrc(path)})`（books 双层同色渐变遮罩公式）；backgroundSize: "cover"; backgroundPosition: "center"
  // 无图：仅 backgroundColor
// api 追加：readingBgImport(path)/readingBgList()/readingBgDelete(id)
```

**tauri.conf.json：** `app.security.assetProtocol = { "enable": true, "scope": ["$APPDATA/background/*"] }`（convertFileSrc 前置条件）。

**SettingPanel 内容（右侧 299px，分区 data-search-key 标注）：**
- 顶部搜索框（见下）
- **配色区** `data-search-key="colors"`：四预设对（READING_BG_PRESETS 圆色圈，选中描边）+「自定义」展开双 `<input type="color">`（背景/文字）——选深底自动切白字的提示文案（不做自动切换，books 的亮度公式留 backlog）
- **背景图区** `data-search-key="bgimage"`：导入按钮（@tauri-apps/plugin-dialog 选文件 → api.readingBgImport → 列表刷新）+ 缩略图网格（点击选用/再点取消；角上 × 删除带确认）+ 不透明度滑条 0-100（选中图时才显示）
- **排版区** `data-search-key="typography"`：字号 13-40 / 行距五选 / 字距 0-2 / 段距 0-3 / 页宽 480-1000 / 页边 0-96 六个滑条（range + 数字显示，即时生效）
- **字体与对齐区**：fontFamily 下拉（默认衬线/楷体/宋体/黑体）、textAlign 左/两端、indent 开关
- **设置搜索**：对全区块建索引 [{key, title}]；输入 → 子序列匹配打分（命中标题整词 1000/前缀 900/子序列 100，照 books 打分表简化）→ 选中项 `querySelector('[data-search-key=…]')` scrollIntoView + 高亮类 1.8s（styles.css .setting-hit 动画）

- [ ] Step 1: Rust 失败测试（import 拷贝文件与扩展校验/list 排序/delete 后 list 空——用 tempfile 造 png 假文件）；前端失败测试（hexToRgba；readingBgStyle 有图/无图两形态与遮罩公式串；SettingPanel 搜索输入后定位高亮、选预设写 prefs）→ 实现 → 绿
- [ ] Step 2: tauri.conf assetProtocol + ReadView 应用背景 + 三件套绿 → Commit `feat: 阅读调整面板——排版滑条/配色预设/自定义背景图/设置搜索`

### Task M3-T7: 悬浮大纲（写作模式）

**Files:**
- Create: `src/components/editor/FloatingOutline.tsx`、`src/stores/outline.ts`、`src/stores/outline.test.ts`、`src/lib/headings.ts` + `.test.ts`
- Modify: `src/components/editor/ChapterEditor.tsx`（顶栏 ListTree 按钮 + jumpTarget 消费 effect）、`src/App.tsx`（Alt+O 全局）、`src/styles.css`（浮窗 + Maple 三件套视觉）

**Interfaces:**
```ts
// src/lib/headings.ts —— 从 markdown 抽两级大纲
export interface Heading { level: 1 | 2; text: string }
export function parseHeadings(markdown: string): Heading[];
// 规则：行首 /^\s{0,3}(#{1,2})\s+(.+)$/（## 及以上收为 level2）；或中文章题 /^\s*(第[〇一二三四五六七八九十百千0-9]{1,7}[章回节][^\n]{0,30})$/ → level1；
// 去重保序；空结果回 []（浮窗显示「本章无小标题」）
// src/stores/outline.ts
export const useOutline = create<{
  open: boolean; jumpTarget: string | null;
  toggle(): void; request(text: string): void; consume(): string | null;
}>();  // 持久化 open 与位置 localStorage "bixian.outline"
```

**要点：** 浮窗 `fixed right-4 top-[15vh] w-64 max-h-[70vh]`，头部可拖拽（pointerdown 记偏移，move 改 left/top，松手落 localStorage）；内容两段——上半「本章」parseHeadings(chapterContent) 列表（点击 request(text)），下半「全书」chapters 列表（点击 selectChapter，当前章高亮）。ChapterEditor 新 effect 消费 jumpTarget：复用既有 findTextPos + setTextSelection + scrollIntoView（搜索跳转同款，代码在 ChapterEditor.tsx:16-25/54-62），消费后 consume()。视觉照 Maple：`ul>li` 缩进引导线（li::after 2px 竖线 var(--border-subtle)）、行首空心圆点（::before border 圆，激活实心 accent）、hover 行 L 形圆角拐角线（border-bottom+border-left+bottom-left-radius）。快捷键 Alt+O。

- [ ] Step 1: 失败测试（parseHeadings：#/中文章题/去重/无标题空数组；outline store request/consume 一次性语义）→ 实现 → 绿
- [ ] Step 2: FloatingOutline + ChapterEditor 消费 + styles → 三件套绿 → Commit `feat: 悬浮大纲——章节两级抽取/拖拽定位/Maple 视觉`

### Task M3-T8: 碰碰车智能批量加词

**Files:**
- Create: `src/views/bump/wordInput.ts` + `wordInput.test.ts`
- Modify: `src/views/bump/BumpWorkspace.tsx`（输入框改造 + 预览条）、`src/views/bump/BumpWorkspace.test.tsx`

**Interfaces:**
```ts
// wordInput.ts
export function parseWords(input: string): string[];
// 切分 /[\s,，、;；。．.!！?？·•|｜/\\]+/（空格/中西标点均认）→ trim → 过滤空与超长（>16 字符丢弃）
// → 去重保序。单词输入（无分隔符）行为不变：["原词"]
// BumpWorkspace 增益：输入含分隔符时 onChange 即析出 pendingWords = parseWords(input)
//   - pendingWords.length > 1 → 输入框下方预览条：「将添加 N 个词」+ 灰色 chips（词库已有的加删除线+「已存在」标）+ 单 chip × 可移除 + 「全部添加」按钮 + Esc 取消
//   - Enter = 全部添加（只加词库没有的）；预览态 Esc = 清空输入与预览
//   - addWord 循环改 bump store 新增 addWords(list: string[])（Rust 端仍逐条 bump_add_word，前端 Promise.all 后一次 load()）
```
Modify `src/stores/bump.ts`：`addWords(list: string[])`（过滤已有 words.map(w=>w.word) 再逐条 invoke，最后 load 刷新）。

- [ ] Step 1: 失败测试（parseWords：空格切/中文标点切/去重保序/超长丢弃/无分隔符原样/空串空数组；组件：粘贴多词出现预览、已存在词删除线、全部添加只调新词、Esc 清空）→ 实现 → 绿
- [ ] Step 2: 三件套绿 → Commit `feat: 碰碰车批量加词——粘贴自动分词/去重预览/一键入库`

### Task M3-T9: 写作统计增强——徽章升级 + 统计面板

**Files:**
- Create: `src/lib/statsMath.ts` + `.test.ts`、`src/components/stats/StatsPanel.tsx` + `.test.tsx`、`src/components/stats/Heatmap.tsx`、`src/components/stats/TrendBars.tsx`、`src/components/ui/Badge.tsx`、`src/components/ui/StatCard.tsx`
- Modify: `src/lib/nav/registry.ts`（write 视图 dockPanels 加 `{id:"stats", label:"统计", icon:BarChart3}`）、`src/components/layout/PanelDock.tsx`（PANEL_COMPONENTS + stats）、`src/components/sidebar/StatsBadge.tsx`（升级）、`src/stores/stats.ts`（+dailyGoal +statsRange 缓存 + loadRange）

**Interfaces:**
```ts
// statsMath.ts（token-meter 纯函数移植，research/token-meter-repo .../StatsSection.tsx:277-297）
export function streaks(dates: string[], today: string): { current: number; longest: number };
  // current：从 today 起（today 无记录则从 yesterday 起）逐日回溯 -1 天计数
  // longest：排序去重后相邻差 1 天累加取 max
export function median(nums: number[]): number;      // 排序取中位（偶数取均值）
export function avgActive(total: number, activeDays: number): number; // 只除活跃日；0 天回 0
export function fmtWords(n: number): string;         // ≥1e8→x.x亿；≥1e4→x.x万；否则 toLocaleString
export function lastNDays(n: number, today: string): string[];        // chart/heatmap 槽位生成
// Badge.tsx：tone: "neutral"|"blue"|"green"|"amber"|"red"|"purple"（webnovel 六色语义）
// StatCard.tsx：{ label, value, sub?, icon? }（label/value/sub 三层结构，tabular-nums）
// stats store 增加：
dailyGoal: number;                 // settings KV key "stats:dailyGoal"（"0"=关闭）；load 时 kvGet，setDailyGoal kvSet
range: DailyStat[]; loadRange: (days: number) => Promise<void>;   // api.statsRange(days, null) 全书聚合
// StatsBadge 升级：今日字数（fmtWords）+ 🔥连续天数（streaks）+ 日目标环形（goal>0 时画，SVG circle stroke-dasharray，达标绿色庆祝态）
```

**StatsPanel（dock tab，纵向滚动）：**
- 顶部：日目标设置（数字输入 + 「字/天」，0=关）+ 口径说明卡（「实打差量：粘贴与 AI 采纳不计；时长为活跃分钟（同分钟记一次）」——token-meter 口径透明化思想）
- 指标卡 grid×2（StatCard）：今日 / 本周 / 30 天 / 累计 / 日均（活跃日）/ 中位 / 当前连续🔥 / 最长连续🏆 / 活跃天数 / 速度（今日字数÷今日活跃分钟，字/分）
- TrendBars：近 30 天柱状（手绘 SVG，1:1 viewBox 按容器实测宽防拉伸——token-meter 手法），叠加日目标横虚线
- Heatmap：近 6 个月 GitHub 式周×日网格（5 档透明度 0.16/0.3/0.5/0.72/0.95），悬浮 title 当日字数/分钟
- 每书进度：books 列表（api.listBooks + chapters word_count 汇总走 workspace store 现有数据不够跨书——新增 api 调用 listChapters per book 过重；改 Rust？**不扩 Rust**：用 api.listBooks + 每书 api.listChapters Promise.all（书数量个位数级，可接受））行 = 书名 + N 字 / 目标 + 进度条 + 预计完本（(目标-当前)/max(近30天日均,1) 天数 → 日期，无目标或日均 0 显示「—」）+ 目标编辑（点击数字弹 inline 输入 → booksSetTarget）

- [ ] Step 1: 失败测试（statsMath 全函数含跨日/闰年无关性——纯字符串日期算术、streaks 断档/今日无记录、median 偶数、fmtWords 三段；Badge/StatCard 渲染；StatsPanel：mock store 数据出卡片值、目标环达标态、口径文案存在）→ 实现 → 绿
- [ ] Step 2: registry/PanelDock 接线 + StatsBadge 升级 → 三件套绿 → Commit `feat: 写作统计增强——连续天数/日目标环/30天趋势/热力图/每书进度`

### Task M3-T10: 伏笔面板（webnovel 紧急度模型）

**Files:**
- Create: `src/components/foreshadow/ForeshadowPanel.tsx` + `.test.tsx`、`src/components/foreshadow/urgency.ts` + `.test.ts`
- Modify: `src/components/layout/PanelDock.tsx`（PANEL_COMPONENTS + foreshadow；PANEL_EMPTY_TEXT 删 foreshadow 行）、`src/stores/foreshadow.ts`（新 store：list/load/upsert/setStatus/remove）

**Interfaces:**
```ts
// urgency.ts —— webnovel-writer foreshadowing.js:38-58 移植（章序号 = chapters 列表下标，由调用方映射）
export type ForeshadowState = "overdue" | "urgent" | "active" | "resolved" | "dropped";
export function urgencyOf(f: {
  status: string;                 // active|resolved|dropped 直接映射后两种
  plantedIdx: number;             // 埋设章序（章被软删时传 -1，显示「章已删」）
  targetIdx: number | null;       // 计划回收章序（null=未定）
  currentIdx: number;             // 当前章序
}): { state: ForeshadowState; remaining: number | null; score: number };
// 算法：elapsed=current-planted；span=target-planted（≤0 视 1）；score=elapsed/span；
//   remaining=target-current；remaining<0→overdue；remaining<=5||score>=2→urgent；否则 active
export const FORESHADOW_TONE: Record<ForeshadowState, Badge["props"]["tone"]>;
  // overdue=red, urgent=amber, active=blue, resolved=green, dropped=neutral（webnovel 四态色同语义）
```

**ForeshadowPanel（dock tab）：**
- 头部：「+ 登记」按钮 + 筛选 segmented（全部/紧急/超期/活跃/已回收，默认收起已回收——webnovel 同款）+ 计数
- 列表行：标题 + 状态 Badge + 「第X章埋 → 第Y章收」（targetIdx null 显「未定」）+ note 首行 + 行内操作（标记回收→弹章选择；搁置；编辑；删除二次确认）
- 登记表单（inline 展开）：标题必填、埋设章下拉（chapters）、计划回收章下拉（含「未定」）、备注 textarea
- **甘特简版**：面板底部通栏（仅「全部/超期/紧急」筛选态显示）：每伏笔一行，CSS 线性条——起点=plantedIdx/总章数%，终点=targetIdx%（未定画到当前+10% 虚段），四态色填充；当前章竖线 absolute 居上（webnovel markLine 语义，纯 CSS 不引 ECharts）
- 章序映射：`const idxById = new Map(chapters.map((c,i)=>[c.id,i]))`；软删章不在列表 → plantedIdx=-1 特判

- [ ] Step 1: 失败测试（urgencyOf：超期/紧急(remaining≤5)/紧急(score≥2)/活跃/未定 target/score 分母 0 防护/软删 -1；Panel：列表渲染+筛选+登记提交调 upsert+标记回收弹层）→ 实现 → 绿
- [ ] Step 2: PanelDock 接线 → 三件套绿 → Commit `feat: 伏笔面板——登记/回收追踪/紧急度四态/章轴甘特`

### Task M3-T11: 编辑器中文排版——首行缩进/段距行距/分场符

**Files:**
- Create: 无新文件（扩展 themes）
- Modify: `src/themes/ThemeProvider.tsx`（AppearanceSettings += `prose: { indent: boolean; lineHeight: number; paraSpacing: number; letterSpacing: number }`，默认 `{true, 1.9, 0.9, 0}`；normalize 兼容旧数据）、`src/styles.css`（.prose-serif 与 .ProseMirror 消费新变量；hr 分场符；.p-indent）、`src/components/settings/AppearancePane.tsx`（「正文排版」区：缩进开关 + 行高 1.5-2.4 / 段距 0-2em / 字距 0-0.1em 三滑条）、`src/components/editor/ChapterEditor.tsx`（EditorContent className 挂 data-prose-indent）、`src/themes/themes.test.ts`

**styles.css 关键段（Maple basic.scss 手法）：**
```css
.prose-serif { line-height: var(--prose-line-height, 1.9); letter-spacing: var(--prose-letter-spacing, 0); }
.ProseMirror p { margin: 0 0 var(--prose-para-spacing, 0.9em); }
.p-indent .ProseMirror p { text-indent: 2em; }        /* 中文小说两字缩进（Maple P0 刚需项） */
.ProseMirror hr {                                    /* 分场符：细线 + 居中 ❖ 徽章（Maple hr.scss） */
  border: none; text-align: center; margin: 1.6em 0;
  overflow: visible; height: auto;
}
.ProseMirror hr::after { content: "❖"; display: inline-block; position: relative; top: -0.75em;
  padding: 0 0.75em; font-size: 0.85em; color: var(--text-faint);
  background: var(--bg-base); }                      /* 底色遮线 */
```
ThemeProvider 把 prose 四项写成 `--prose-*` 变量注入既有主题 style 节点（themeCss 之外的追加段）+ html data-prose-indent 属性。

- [ ] Step 1: 失败测试（normalizeAppearance 旧数据无 prose 字段回默认；prose 变量注入后 themeCss 输出含 --prose-line-height）→ 实现 → 绿
- [ ] Step 2: AppearancePane 排版区 + styles.css → 三件套绿 → Commit `feat: 编辑器排版——首行缩进/行高段距字距/分场符`

### Task M3-T12: M3 收尾

**Files:**
- Modify: `README.md`（M3 功能段 + 数据位置补 background/ 与伏笔表）、`docs/superpowers/plans/2026-09-19-m3-*.md`（勾选完成态）

- [ ] Step 1: 三件套 + `pnpm tauri build --no-bundle` 产物确认（注意先关运行中的笔仙）
- [ ] Step 2: README 补 M3 → Commit `feat: M3 收尾——README/文档` → push GitHub

---

## 功能拆解总表（用户「先拆解再提供」要求的完整菜单）

**本计划实现（P0）**：阅读模式全核心（四边面板/热区/锁定/调整面板/背景图/进度记忆/设置搜索）、纸张纹理六预设、右栏收缩、悬浮大纲、批量加词、统计全家桶（连续/中位/日均/热力图/趋势/日目标/每书进度/预计完本/口径卡）、伏笔紧急度面板、首行缩进+分场符、Badge/StatCard 组件化。

**Backlog（明确不做，后续里程碑候选）**：
- books-reader：摸鱼模式（无边框透明窗，Tauri 参考实现已在 books-reader src-tauri/system_cmds.rs:226）、竖排、简繁转换、仿生阅读、双页分页/仿真翻页、TTS、书签/高亮笔记体系、每书独立阅读样式、自定义字体导入（@font-face）、剩余阅读时长估算、heti/漢字標準格式排版引擎
- Maple：HSL 通道化主题（色相滑块换装）、彩色标题六级、标题等级 H1-H6 角标、引言大引号、标签双样式、图片灯箱/图注、统一动画时长变量、内嵌字体 base64、勾选框样式集
- webnovel-writer：角色关系力导向图+时间轴播放、钩子强度/节奏雷达（依赖每章评分数据管道，先有数据再谈图）、最近章概要卡（依赖章概要生成）
- token-meter：24 小时时段分布（需事件级流水表 writing_events）、AI 用量/成本统计（依赖 provider usage 记录）、统计分享卡导出

## 计划自审记录

- **需求覆盖**：用户六点 → ①阅读模式 T4/T5/T6（books 机制全内联）②批量加词 T8 ③主题升级=T3 纹理+T6 阅读背景图（books 高级背景的阅读侧）④Maple=T3 纹理+T7 悬浮大纲+T11 缩进/分场符，完整拆解表如上 ⑤右栏收缩 T2+统计增强 T9（token-meter 指标全表已筛）⑥webnovel=T9 StatCard/Badge+T10 伏笔面板（其「编辑器排版」经查无可借鉴项——它没有编辑器，报告原文确认笔仙现有排版已优）
- **依赖顺序**：T1（数据层）← T9/T10；T4 ← T5 ← T6（阅读三段递进）；T2/T3/T7/T8/T11 相互独立可并行；迁移只有 0007 一个文件避免冲突
- **类型一致性**：setting_get/set 在 T1 产出、T4(kv.ts)/T9(dailyGoal)/T4(进度) 消费同名；Foreshadow/ForeshadowInput T1 定义 T10 消费；ReadingPrefs T4 定义 T6 消费（bgImage 字段预留）；statsMath T9 内聚；Badge tone 六值 T9 定义 T10 消费
- **WebView2 风险**：背景图走 convertFileSrc（T6 已配 assetProtocol scope）；纹理 data URI 为几百字节级不受影响
- **范围控制**：人物图谱顺延 M4；Backlog 清单 22 项明确列出防蔓延
