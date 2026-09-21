# M6 卡片改版实现计划：kindling(Press) 卡片交互语法 × 笔仙 zen 皮肤

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 kindling（smith-and-web/kindling，"Press" 设计系统）的卡片交互语法——hover 边框律动、次级操作浮现、展开/收起节奏、统一的尺寸与字号阶梯——移植到笔仙，解决现有卡片"太小、不好看"的问题；配色、骨架、动效 token 全部保留笔仙 zen 风格。

**Architecture:** 先建 `ui/Card.tsx` 统一卡片外壳（variant × pad × interactive × selected 四个维度）与 focus-ring token，然后逐面板替换：统计、素材、碰碰车、人物、伏笔/情节块（dock）、选中态家族。共 7 个任务，每个独立可测、独立提交。

**Tech Stack:** React 19 + Tailwind CSS v4（CSS-first，无 config 文件）+ vitest + @testing-library/react。样式全部内联 Tailwind 任意值语法 `bg-[var(--xxx)]`（仓库既有模式）。

**Spec:** 用户需求（2026-09-21 对话）＋ kindling 源码参考（已下载到 `D:\Mycraft\_reference\kindling-main`，重点是 `src/styles/press/tokens.css`、`DESIGN_GUIDE.md`、`src/lib/components/{BeatView,ReferencesPanel,TemplateBrowser,SuggestionCard}.svelte`）。

## Global Constraints

### 保留的 zen 骨架（不可破坏）

- 所有颜色走 CSS 变量（`--bg-*` / `--border-*` / `--text-*` / `--accent*`），**禁止硬编码 hex**；十套主题（`src/themes/defs.ts`）必须全部正常。
- 圆角用 token：`--radius-sm:6px` / `--radius-md:8px` / `--radius-lg:14px`。卡片一律 `rounded-[var(--radius-md)]`；弹窗/大卡 `rounded-[var(--radius-lg)]`。**废弃裸 `rounded-md/lg/xl`**（tailwind 档位绕过 token 体系）。
- 动效用 token：`--dur-fast:.1s` / `--dur-md:.15s`（kindling 是 .1/.2s； zen 的 .15s 是骨架的一部分，保留）。
- 按压反馈 `active:scale-[0.98]`（Button 已有）保留；浮卡骨架（背板 + 8px 缝隙 + shadow-pop）不动；纹理层不动。

### kindling → zen 映射表（所有任务按此取值）

| kindling (Press) | 精确值 | 笔仙 zen 等价 |
|---|---|---|
| 卡容器 raised | `#FBF8F1` + 8px 圆角 | `bg-[var(--bg-elevated)] rounded-[var(--radius-md)]` |
| 卡内头部条 sunken | `#ECE4D6` | `bg-[var(--bg-panel)]`（elevated 上自动深一档） |
| 发丝边框 | `rgba(35,29,24,.13)` | `border-[color:var(--border-subtle)]` |
| hover 边框变交互色 | `border → terracotta`，0.2s | `hover:border-[color:var(--accent)]` + `transition-colors duration-[var(--dur-md)]` |
| 选中态 wash | `border-accent + 8% wash` | `border-[color:var(--accent)] bg-[var(--accent-dim)]`（zen 既有语法，1px 边框） |
| 次级操作浮现 | `opacity-0 → 100` | 同，`opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100` |
| 操作图标 | `w-3.5`(14px) / `w-4`(16px) | lucide `size={14}`（次级操作）/ `size={14}` 主操作 |
| 徽章 pill | 12px `px-1.5 py-0.5 rounded-full` | `text-xs`（12px），见 Task 7 Badge 升档 |
| 编号/头像圆徽 | `w-6`/`w-8` accent 圆 | `h-7 w-7 rounded-full bg-[var(--accent-dim)]`（首字圆徽，Task 5） |
| 空态虚线卡 | `border-dashed`，hover 变 accent | 已有，仅圆角 token 化 |
| focus ring | `0 0 0 3px` 40% 交互色 | `--focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent)`（Task 1） |
| 展开/收起 | chevron 旋转 180° + 1px 分隔线 | `transition-transform duration-[var(--dur-md)] rotate-180` + `border-t border-[color:var(--border-subtle)]` |

### 卡片尺寸两档（解决"太小"）

- **dock 窄卡**（约 300px 栏：人物/伏笔/情节块）：`px-3 py-2.5`，列表 `space-y-2` 或 `gap-2`。
- **全页卡**（素材/灵感/统计/主题/服务商）：`p-4`（素材/灵感）或 `p-3`（StatCard 密度卡），网格 `gap-3`。

### 字号阶梯（卡内）

1. 卡标题：`text-sm`(14px) `font-medium`——现有 text-xs(12px) 标题一律升档。
2. 卡正文/描述/元信息：`text-xs`(12px)——现有 `text-[11px]` 正文性文字升到 12px。
3. 徽章/pill：`text-xs`(12px)；时间戳/计数等纯辅助：`text-[11px]`；**卡内禁用 `text-[10px]`**。

### 测试策略

- **行为改动写新测试**（Card 组件、人物卡展开/收起）：先写失败测试再实现。
- **纯样式改动靠回归**：跑该组件现有测试 + `npm test` 全量，不断言样式字符串（脆测试没价值）。
- 每个任务完成后建议 `npm run tauri dev` 目测一次（亮/暗各看一眼，切两套主题确认变量没漏）。

### Out of scope（本计划不做）

- dock INPUT 常量收敛（约 8 处重复）——是另一件事，卡片之外。
- chat 气泡 / PermissionCard / ContextPreview——对话流不是卡片语法问题。
- 图谱三视图画布内元素——SVG 画布有自己的体系（M5 刚做完）。
- 任何后端 / store / 数据改动。

---

### Task 1: 卡片底座——Card 组件 + focus-ring token

**Files:**
- Modify: `src/styles.css`（`:root` zen token 区块，约 35-45 行处）
- Create: `src/components/ui/Card.tsx`
- Test: `src/components/ui/Card.test.tsx`

**Interfaces:**
- Produces: `Card` 组件，props：`variant?: "flat" | "raised"`（flat=透明底 dock 卡，raised=elevated 底全页卡）、`pad?: "sm" | "md"`（sm=px-3 py-2.5，md=p-4）、`interactive?: boolean`（hover 边框变 accent）、`selected?: boolean`（accent 边框 + accent-dim 洗色），根元素恒带 `group`，透传其余 `HTMLAttributes<HTMLDivElement>`。Task 3/4 消费。

- [ ] **Step 1: 写失败测试**

`src/components/ui/Card.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./Card";

describe("Card", () => {
  it("默认 raised + md：elevated 底、p-4、token 圆角与边框", () => {
    render(<Card data-testid="c">内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("bg-[var(--bg-elevated)]");
    expect(c.className).toContain("p-4");
    expect(c.className).toContain("rounded-[var(--radius-md)]");
    expect(c.className).toContain("border-[color:var(--border-subtle)]");
  });

  it("flat + sm：无底色、窄内边距", () => {
    render(<Card data-testid="c" variant="flat" pad="sm">内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).not.toContain("bg-[var(--bg-elevated)]");
    expect(c.className).toContain("px-3");
    expect(c.className).toContain("py-2.5");
  });

  it("interactive：hover 边框变 accent，带 zen 过渡", () => {
    render(<Card data-testid="c" interactive>内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("hover:border-[color:var(--accent)]");
    expect(c.className).toContain("transition-colors");
    expect(c.className).toContain("duration-[var(--dur-md)]");
  });

  it("selected：accent 边框 + 洗色底，且不再叠加 raised 底", () => {
    render(<Card data-testid="c" selected>内容</Card>);
    const c = screen.getByTestId("c");
    expect(c.className).toContain("border-[color:var(--accent)]");
    expect(c.className).toContain("bg-[var(--accent-dim)]");
    expect(c.className).not.toContain("bg-[var(--bg-elevated)]");
  });

  it("根恒带 group，供卡内操作 group-hover 浮现；透传 data-* 等属性", () => {
    render(<Card data-testid="c">内容</Card>);
    expect(screen.getByTestId("c").className).toContain("group");
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/ui/Card.test.tsx`
Expected: FAIL（`Cannot find module './Card'`）

- [ ] **Step 3: 实现 Card 组件**

`src/components/ui/Card.tsx`：

```tsx
import type { HTMLAttributes } from "react";

// 统一卡片外壳（M6：kindling Press 卡片语法 × zen 皮肤）。
// - variant: flat=透明底（dock 列表卡，透出 panel 底） raised=elevated 底（全页/网格卡）
// - pad:     sm=dock 窄卡 (px-3 py-2.5)  md=全页卡 (p-4)
// - interactive: 可交互卡——hover 只变边框色（kindling 律动：不动布局、不位移）
// - selected:    选中卡——accent 边框 + accent-dim 洗色（kindling 模板卡选中语法）
// 根元素恒带 group：卡内次级操作用 opacity-0 group-hover:opacity-100 浮现。
type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "flat" | "raised";
  pad?: "sm" | "md";
  interactive?: boolean;
  selected?: boolean;
};

export function Card({
  variant = "raised",
  pad = "md",
  interactive = false,
  selected = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const padCls = pad === "sm" ? "px-3 py-2.5" : "p-4";
  // selected 的洗色底与 raised 底互斥（Tailwind 同属性冲突不保证覆盖顺序），选中时只出洗色。
  const surface = selected
    ? ""
    : variant === "raised"
      ? "bg-[var(--bg-elevated)]"
      : "";
  const state = selected
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : interactive
      ? "border-[color:var(--border-subtle)] transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]"
      : "border-[color:var(--border-subtle)]";
  return (
    <div
      className={`group rounded-[var(--radius-md)] border ${padCls} ${surface} ${state} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/ui/Card.test.tsx`
Expected: PASS（5 个用例全绿）

- [ ] **Step 5: styles.css 加 focus-ring token 与全局 focus-visible 规则**

`src/styles.css`——在 `:root` 的 `--sep: 8px;` 之后追加：

```css
  /* 卡片/按钮焦点环（M6，kindling 手法：交互色 30% 洗色，从 accent 派生，主题免维护） */
  --focus-ring: 0 0 0 3px color-mix(in srgb, var(--accent) 30%, transparent);
```

在全局滚动条规则附近（`:root` 块之后、组件样式区）追加：

```css
/* 键盘焦点环（kindling app.css 同款）：鼠标点击不出环，Tab 导航可见 */
:where(button, [role="button"]):focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

- [ ] **Step 6: 全量回归 + 提交**

Run: `npm test`
Expected: 全绿（新增 5 例，无既有用例破坏）

```bash
git add src/components/ui/Card.tsx src/components/ui/Card.test.tsx src/styles.css
git commit -m "feat: M6-T1 卡片底座——Card 组件（flat/raised × sm/md + interactive/selected）与 focus-ring token"
```

---

### Task 2: 统计卡升档——StatCard 与指标网格

**Files:**
- Modify: `src/components/ui/StatCard.tsx`
- Modify: `src/components/stats/StatsPanel.tsx:143`（指标网格）、`StatsPanel.tsx:175`（每书列表）、`StatsPanel.tsx:188`（每书进度卡容器）

**Interfaces:**
- Consumes: 无（纯样式，StatCard 的 props 签名不变：`label/value/sub/icon`）
- Produces: 无

- [ ] **Step 1: StatCard 升档**

`src/components/ui/StatCard.tsx` 全量替换为：

```tsx
import type { LucideIcon } from "lucide-react";

// 指标小卡（M3-T9；M6 卡片改版升档）：label / value / sub 三层，数字 tabular-nums。
// 尺寸 px-2.5 py-2 → p-3；label 11px→12px；value 16→18px；图标 12→14（kindling 字号律）。
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[color:var(--text-faint)]">
        {Icon && <Icon size={14} className="shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums text-[color:var(--text-primary)]">
        {value}
      </div>
      {sub !== undefined && (
        <div className="text-xs leading-snug text-[color:var(--text-faint)]">{sub}</div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: StatsPanel 三处容器升档**

`src/components/stats/StatsPanel.tsx`：

143 行，指标网格（10 张卡）：
```tsx
{/* 改前 */} <div className="grid grid-cols-2 gap-1.5">
{/* 改后 */} <div className="grid grid-cols-2 gap-3">
```

175 行，每书列表：
```tsx
{/* 改前 */} <div className="flex flex-col gap-1.5">
{/* 改后 */} <div className="flex flex-col gap-2">
```

188 行，每书进度卡容器（内部进度条结构不动）：
```tsx
{/* 改前 */} <div key={b.id} className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-2">
{/* 改后 */} <div key={b.id} className="rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] p-3">
```

注意：135 行的说明文字块、177 行空态卡**不在本次范围**（非卡片主体）。

- [ ] **Step 3: 回归**

Run: `npx vitest run src/components/stats/StatsPanel.test.tsx && npm test`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add src/components/ui/StatCard.tsx src/components/stats/StatsPanel.tsx
git commit -m "feat: M6-T2 统计卡升档——StatCard p-3/12px 标签/18px 数字，指标网格 gap-3"
```

---

### Task 3: 素材卡 kindling 化——MaterialsWorkspace

**Files:**
- Modify: `src/components/materials/MaterialsWorkspace.tsx:148-203`（分组网格与素材卡）

**Interfaces:**
- Consumes: `Card`（Task 1）
- Produces: 无

- [ ] **Step 1: 替换素材卡为 Card 壳**

`src/components/materials/MaterialsWorkspace.tsx`——文件头 import 区加：

```tsx
import { Card } from "../ui/Card";
```

148-201 行，网格与卡（操作钮图标 12→14，标题保留 text-sm，描述/徽章区不变）：

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
  {g.items.map((m) => (
    <Card key={m.id} interactive className="flex flex-col gap-2">
      <div className="flex items-start gap-1">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]" title={m.title}>
          {m.title}
        </span>
        <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100">
          <button
            title="编辑"
            onClick={() =>
              setForm({ id: m.id, title: m.title, category: m.category, content: m.content, tags: m.tags })
            }
            className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
          >
            <Pencil size={14} />
          </button>
          {confirmDelId === m.id ? (
            <button
              onClick={() => {
                void remove(m.id);
                setConfirmDelId(null);
              }}
              className="rounded bg-[color:var(--danger)]/15 px-1.5 py-1 text-xs text-[color:var(--danger)] transition-colors duration-150 hover:bg-[color:var(--danger)]/25"
            >
              确认
            </button>
          ) : (
            <button
              title="删除"
              onClick={() => setConfirmDelId(m.id)}
              className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {m.content && (
        <div className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--text-secondary)]">
          {m.content}
        </div>
      )}
      {m.tags && (
        <div className="flex flex-wrap gap-1">
          {m.tags.split(",").filter(Boolean).map((t) => (
            <Badge key={t} tone="neutral">{t.trim()}</Badge>
          ))}
        </div>
      )}
    </Card>
  ))}
</div>
```

要点：原 `bg-[var(--bg-panel)] p-3`（在 panel 视图底上等于透明）换 Card 默认 `raised p-4`——卡片真正"浮"起来一层（kindling 卡片深度感的来源）；hover 边框变 accent。

- [ ] **Step 2: 回归**

Run: `npx vitest run src/components/materials/MaterialsWorkspace.test.tsx && npm test`
Expected: 全绿

- [ ] **Step 3: 提交**

```bash
git add src/components/materials/MaterialsWorkspace.tsx
git commit -m "feat: M6-T3 素材卡 kindling 化——Card raised 壳 + hover accent 边框 + 图标 14px"
```

---

### Task 4: 碰碰车卡片——大卡 token 化 + 灵感卡升档

**Files:**
- Modify: `src/views/bump/BumpWorkspace.tsx:210`（碰撞大卡）、`BumpWorkspace.tsx:239`（空态虚线卡）
- Modify: `src/views/bump/IdeaCardShelf.tsx:26-66`（灵感卡列表）

**Interfaces:**
- Consumes: `Card`（Task 1）
- Produces: 无

- [ ] **Step 1: BumpWorkspace 两处**

210 行碰撞大卡（rounded-xl 超出 token 体系 → radius-lg token；这是视图的"display 时刻"，p-6 与 text-2xl 保留）：
```tsx
{/* 改前 */} <div className="rounded-xl border border-[color:var(--border-strong)] bg-[var(--bg-panel)] p-6 text-center">
{/* 改后 */} <div className="rounded-[var(--radius-lg)] border border-[color:var(--border-strong)] bg-[var(--bg-elevated)] p-6 text-center">
```

239 行空态虚线卡：
```tsx
{/* 改前 */} <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] px-6 py-12 text-center text-xs text-[color:var(--text-faint)]">
{/* 改后 */} <div className="rounded-[var(--radius-lg)] border border-dashed border-[color:var(--border-subtle)] px-6 py-12 text-center text-xs text-[color:var(--text-faint)]">
```

- [ ] **Step 2: IdeaCardShelf 灵感卡**

`src/views/bump/IdeaCardShelf.tsx`——import 区加 `import { Card } from "../../components/ui/Card";`，26-66 行卡列表替换为：

```tsx
<div className="flex flex-col gap-2.5">
  {ideas.map((idea) => {
    const list = parseList(idea.words_json);
    const tags = parseList(idea.tags_json);
    return (
      <Card key={idea.id} interactive className="flex flex-col">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 text-sm font-medium text-[color:var(--text-primary)]">
            {list.join(" × ")}
          </div>
          <button
            onClick={() => void removeIdea(idea.id)}
            title="删除灵感卡"
            className="shrink-0 rounded p-1 text-[color:var(--text-faint)] opacity-0 transition-opacity duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)] group-hover:opacity-100"
          >
            <Trash2 size={14} />
          </button>
        </div>
        {idea.content && (
          <div className="mt-1.5 whitespace-pre-wrap break-words text-xs text-[color:var(--text-secondary)]">
            {idea.content}
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full bg-[var(--accent-dim)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-secondary)]"
            >
              {t}
            </span>
          ))}
          <span className="ml-auto text-[11px] text-[color:var(--text-faint)]">{idea.created_at}</span>
        </div>
      </Card>
    );
  })}
</div>
```

要点：hover 边框从 `border-strong` 升为 `accent`（与全局可交互卡语法一致）；标签/时间戳 10px→11px（纯辅助信息档）；删除图标 12→14。

- [ ] **Step 3: 回归**

Run: `npx vitest run src/views/bump/BumpWorkspace.test.tsx && npm test`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add src/views/bump/BumpWorkspace.tsx src/views/bump/IdeaCardShelf.tsx
git commit -m "feat: M6-T4 碰碰车卡片——大卡 token 圆角 + 灵感卡 Card 壳 hover accent"
```

---

### Task 5: 人物卡——首字圆徽 + hover 边框 + 展开/收起

**Files:**
- Modify: `src/components/characters/CharactersPanel.tsx:146-190`（列表区）
- Test: `src/components/characters/CharactersPanel.test.tsx`（追加用例）

**Interfaces:**
- Consumes: 无新组件（人物卡是 button 布局，用 Card 会引入嵌套 button，直接手写同语法 class）
- Produces: 新增本地 state `expandedId: number | null`（仅组件内部，无外部消费）

- [ ] **Step 1: 写失败测试（展开/收起行为）**

在现有 `src/components/characters/CharactersPanel.test.tsx` 的 describe 块内追加（沿用该文件已有的 mock/store 设定方式；若文件里还没有 store 预置，在测试内用 `setState` 直设，字段以面板代码为准）：

```tsx
it("人物卡默认收起描述（line-clamp-2），点卡身展开/再收起，chevron 随之旋转", async () => {
  useCharacters.setState({
    list: [
      { id: 1, book_id: 1, name: "林晚", role: "主角", aliases: "晚娘",
        description: "身世成谜的少女。\n第二行。\n第三行。" },
    ],
  });
  render(<CharactersPanel />);

  const desc = await screen.findByText(/身世成谜的少女/);
  expect(desc.className).toContain("line-clamp-2");

  const toggle = screen.getByRole("button", { name: /林晚/ });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText(/身世成谜的少女/).className).not.toContain("line-clamp-2");
  expect(document.querySelector(".rotate-180")).not.toBeNull();

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByText(/身世成谜的少女/).className).toContain("line-clamp-2");
});
```

（若现有测试文件已 mock `../../lib/tauri` 等，复用其 mock；store 的 `load/upsert/remove` 若为真实现会调后端，需在 `setState` 时一并提供 `load: vi.fn()` 等替换，参照 `TrashPanel.test.tsx` 的做法。）

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/characters/CharactersPanel.test.tsx`
Expected: FAIL（找不到 `aria-expanded` / `line-clamp-2`——旧卡没有这些）

- [ ] **Step 3: 实现新人物卡**

`src/components/characters/CharactersPanel.tsx`：

import 行改为（加 ChevronDown）：
```tsx
import { ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
```

组件 state 区（`const [error, setError] = ...` 之后）加：
```tsx
const [expandedId, setExpandedId] = useState<number | null>(null);
```

146-189 行列表区替换为（kindling ReferencesPanel 卡语法：圆徽 + 收起时 line-clamp 预览 + 展开时 border-t 分隔；编辑/删除 hover 浮现）：

```tsx
{list.length === 0 && !formOpen ? (
  <div className="px-2 py-8 text-center text-xs text-[color:var(--text-faint)]">
    还没有人物卡——「新建」登记第一个人物
  </div>
) : (
  <div className="space-y-2">
    {list.map((c) => {
      const expanded = expandedId === c.id;
      return (
        <div
          key={c.id}
          className="group rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5 transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]"
        >
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpandedId(expanded ? null : c.id)}
              aria-expanded={expanded}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-dim)] text-xs font-medium text-[color:var(--text-primary)]">
                {c.name.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]">
                {c.name}
              </span>
              {c.role && <Badge tone="purple">{c.role}</Badge>}
              {relCount(c.id) > 0 && (
                <Badge tone="neutral" title="在图谱视图中点角色可编辑关系">
                  {relCount(c.id)} 关系
                </Badge>
              )}
              <ChevronDown
                size={14}
                aria-hidden
                className={`shrink-0 text-[color:var(--text-faint)] transition-transform duration-[var(--dur-md)] ${expanded ? "rotate-180" : ""}`}
              />
            </button>
            <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100">
              <button onClick={() => openEdit(c)} title="编辑" className={ICON_BTN}>
                <Pencil size={14} />
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`删除人物卡「${c.name}」？`)) void remove(c.id);
                }}
                title="删除"
                className={ICON_BTN}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          {(c.aliases || c.description) && (
            <div className={expanded ? "mt-2 space-y-1 border-t border-[color:var(--border-subtle)] pt-2" : "mt-1.5 space-y-1"}>
              {c.aliases && (
                <div className="text-xs text-[color:var(--text-faint)]">别名：{c.aliases}</div>
              )}
              {c.description && (
                <div
                  className={`whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--text-secondary)] ${expanded ? "" : "line-clamp-2"}`}
                >
                  {c.description}
                </div>
              )}
            </div>
          )}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/characters/CharactersPanel.test.tsx`
Expected: PASS（新旧用例全绿）

- [ ] **Step 5: 全量回归 + 提交**

Run: `npm test`
Expected: 全绿

```bash
git add src/components/characters/CharactersPanel.tsx src/components/characters/CharactersPanel.test.tsx
git commit -m "feat: M6-T5 人物卡——首字圆徽 + hover accent 边框 + 展开/收起（chevron 旋转 + line-clamp 预览）"
```

---

### Task 6: dock 双卡升档——伏笔卡 + 情节块卡

**Files:**
- Modify: `src/components/foreshadow/ForeshadowPanel.tsx:314-418`（伏笔卡）
- Modify: `src/components/plot/PlotBlocksPanel.tsx:108-180`（情节块卡列表）

**Interfaces:**
- Consumes: 无
- Produces: 无

- [ ] **Step 1: 伏笔卡升档**

`src/components/foreshadow/ForeshadowPanel.tsx` 314 行卡容器：

```tsx
{/* 改前 */} <div key={r.f.id} className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-2">
{/* 改后 */} <div key={r.f.id} className="group rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] px-3 py-2.5 transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]">
```

卡内三处字号/图标（316-339 行）：

```tsx
{/* 标题：text-xs → text-sm font-medium */}
<span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]" title={r.f.title}>

{/* 元信息行（埋→收 / 剩余章数）：text-[11px] → text-xs */}
<div className="mt-1 flex items-center gap-2 text-xs text-[color:var(--text-faint)]">

{/* note 行：text-[11px] → text-xs */}
<div className="mt-1 truncate text-xs text-[color:var(--text-faint)]" title={r.f.note}>
```

操作行图标（Check / Pause / Pencil / Trash2 的 `size={12}`）全部改 `size={14}`；行内「确认」按钮 `text-[11px]` → `text-xs`。列表容器（`visible.map` 的父级）若为 `gap-1.5` 升 `gap-2`。

- [ ] **Step 2: 情节块卡升档**

`src/components/plot/PlotBlocksPanel.tsx` 114 行卡容器：

```tsx
{/* 改前 */} <li key={b.id} className="group flex items-start gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
{/* 改后 */} <li key={b.id} className="group flex items-start gap-2 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-3 py-2.5 transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]">
```

卡内图标：ArrowUp / ArrowDown `size={12}` → `size={14}`；徽章内 ChevronRight `size={10}` 保留（徽章内微缩图标）；行内「删除」`text-[11px]` → `text-xs`、X `size={11}` → `size={12}`。列表容器 108 行 `flex flex-col gap-1.5` → `gap-2`。

- [ ] **Step 3: 回归**

Run: `npx vitest run src/components/foreshadow/ForeshadowPanel.test.tsx src/components/plot/PlotBlocksPanel.test.tsx && npm test`
Expected: 全绿

- [ ] **Step 4: 提交**

```bash
git add src/components/foreshadow/ForeshadowPanel.tsx src/components/plot/PlotBlocksPanel.tsx
git commit -m "feat: M6-T6 dock 双卡升档——伏笔/情节块 px-3 py-2.5 + hover accent 边框 + 标题 14px"
```

---

### Task 7: 选中态家族统一 + Badge 升档

四个"可选中卡"（文风/主题/服务商/agent）统一 kindling 选中语法：**选中 = accent 边框 + accent-dim 洗色；未选中 = subtle 边框 + hover 变 accent 边框**（废弃 `hover:bg-hover`，hover 律动全站统一为边框色）。

**Files:**
- Modify: `src/components/ui/Badge.tsx`（`text-[11px]` → `text-xs`）
- Modify: `src/components/styles/StylePanel.tsx:135-161`（文风卡 button）
- Modify: `src/components/settings/AppearancePane.tsx:69-105`（主题卡 button）
- Modify: `src/components/settings/AgentsPane.tsx:204`（agent 卡容器）
- Modify: `src/components/settings/SettingsModal.tsx:154-174`（服务商卡 button）

**Interfaces:**
- Consumes: 无
- Produces: 无（Badge 的 props 不变，仅字号）

- [ ] **Step 1: Badge 升档**

`src/components/ui/Badge.tsx`：`text-[11px]` → `text-xs`（一处；px-1.5 py-0.5 rounded-full 不变）。Badge 全站大量使用，本步之后必须全量回归。

- [ ] **Step 2: 文风卡（StylePanel.tsx 135-161）**

```tsx
{/* 改前 */}
className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 ${
  s.id === activeStyleId
    ? "border-[color:var(--accent)]"
    : s.id === editingId
      ? "border-[color:var(--border-strong)]"
      : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
}`}

{/* 改后 */}
className={`flex w-full flex-col rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors duration-[var(--dur-md)] ${
  s.id === activeStyleId
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : s.id === editingId
      ? "border-[color:var(--border-strong)]"
      : "border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]"
}`}
```

131 行列表容器 `flex flex-col gap-1.5` → `gap-2`。卡内标签 pill `text-xs` 保持（155 行）。

- [ ] **Step 3: 主题卡（AppearancePane.tsx 69-105）**

```tsx
{/* 改前 */}
className={`rounded-lg border p-2.5 text-left transition-colors duration-150 ${
  active
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
}`}

{/* 改后 */}
className={`rounded-[var(--radius-md)] border p-3 text-left transition-colors duration-[var(--dur-md)] ${
  active
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : "border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]"
}`}
```

mini 预览内正文示例 84 行 `text-[10px]` → `text-[11px]`（预览是缩微正文，非卡内信息，11px 档）。65 行网格 `gap-2.5` 保留。

- [ ] **Step 4: agent 卡（AgentsPane.tsx 204）与服务商卡（SettingsModal.tsx 154-174）**

AgentsPane 204 行：
```tsx
{/* 改前 */} <div key={a.id} className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-2">
{/* 改后 */} <div key={a.id} className="rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] px-3 py-2.5 transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]">
```
211 行「默认」徽章 `text-[10px]` → `text-xs`；214 行 command mono `text-[10px]` → `text-[11px]`（命令行是等宽辅助信息，11px 档）。202 行列表 `gap-1.5` → `gap-2`。

SettingsModal 157-163 行（button，可点击整卡）：
```tsx
{/* 改前 */}
className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 ${
  isActive
    ? "border-[color:var(--accent)]"
    : isEditing
      ? "border-[color:var(--border-strong)]"
      : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
}`}

{/* 改后 */}
className={`flex w-full items-center gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-left transition-colors duration-[var(--dur-md)] ${
  isActive
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : isEditing
      ? "border-[color:var(--border-strong)]"
      : "border-[color:var(--border-subtle)] hover:border-[color:var(--accent)]"
}`}
```
144 行列表 `gap-1.5` → `gap-2`。

- [ ] **Step 5: 全量回归**

Run: `npm test`
Expected: 全绿（Badge 影响面广，若有快照/文本断言失败，逐个核对是字号引起的展示性断言再更新）

- [ ] **Step 6: 提交**

```bash
git add src/components/ui/Badge.tsx src/components/styles/StylePanel.tsx src/components/settings/AppearancePane.tsx src/components/settings/AgentsPane.tsx src/components/settings/SettingsModal.tsx
git commit -m "feat: M6-T7 选中态家族统一——文风/主题/服务商/agent 卡 accent+洗色选中、hover 边框律动，Badge 12px"
```

---

## Self-Review 记录

1. **覆盖核对**：用户痛点「太小」→ 全局尺寸两档 + 字号阶梯（T2-T7 全部落地）；「不好看」→ hover 边框律动统一（T3-T7）、卡片深度（T3 raised）、圆徽（T5）、选中语法（T7）；「kindling 交互」→ hover 浮现操作（T3/T5 已有或新增）、展开/收起（T5）、focus ring（T1）。✓
2. **占位符扫描**：T5 Step 1 的 mock 说明是"沿用现有文件 mock 模式"的指引而非代码缺失，测试体完整；其余任务均给出精确改前/改后。✓
3. **类型一致性**：Card 的四个 prop 名（variant/pad/interactive/selected）与 T3/T4 消费处一致；`duration-[var(--dur-md)]` / `rounded-[var(--radius-md)]` 语法与仓库既有用法一致。✓
4. **范围外**：INPUT 收敛、chat 气泡、图谱画布明确排除，避免摊子过大。
