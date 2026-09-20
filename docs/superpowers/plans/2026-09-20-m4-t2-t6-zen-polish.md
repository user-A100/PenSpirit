# M4 第一批剩余（T2–T6）+ Zen UI 收尾 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 M4 第一批剩余五项（自定义分章正则 / 文件夹导入 / 导入查重 / 伏笔还债登记 / 占位符扫描）并收尾 Zen UI（背板对比度 + 暗色实机核验）。

**Architecture:** 导入链三项（T2/T3/T4）都落在 `porting/import.rs` 与 `ImportWizard.tsx`：规则在 Rust 侧 preview 时编译应用，文件夹导入复用同一 `ParsedChapter` 流，查重在 `import_chapters_inner` 落 hash、预览时反查。伏笔还债是 `foreshadows` 两列 + `urgencyOf` 换截止章。占位符扫描是纯前端正则 + 复用 `ui/Modal`。背板对比度不改主题表——在 `themeCss` 生成时派生 `--bg-backdrop`。

**Tech Stack:** Rust（tauri 2 / rusqlite / 新增 `regex`、`md5`）、React + vitest + @testing-library、CDP（WebView2 `--remote-debugging-port=9222`）。

**Spec:** `docs/superpowers/plans/2026-09-20-m4-migration.md`（迁移总表 C2/C3/C4/A2/D3 + 第一批任务分解）。

## Global Constraints

- Rust 新增依赖仅两个：`regex = "1.11"`、`md5 = "0.7"`；前端零新增依赖。
- 前端组件一律用现有 ui kit（`Button`/`Input`/`Modal`/`Badge`）与主题 CSS 变量；圆角/阴影/时长走 `--radius-*`/`--shadow-pop`/`--dur-md`。
- Tauri command 参数前端侧 camelCase、Rust 结构体字段 snake_case（wire 惯例，与现有代码一致）。
- 迁移文件命名 `0011_`/`0012_` 前缀，rusqlite_migration 按文件名序自动执行，**不可修改已存在的迁移**。
- Rust 测试：`*_inner` 函数直调 + `tempfile` + `AppState::test_state(tmp.path())`（见 `commands.rs:841` bg_tests 的既有范式）。前端测试：vitest + happy-dom。
- 实机验证脚本必须**先读用户当前主题、结尾还原**（用户偏好存 localStorage `bixian.appearance`，脚本改主题会落盘——踩过的坑）。
- 提交信息中文 `feat:`/`fix:` 前缀，一个任务一提交。

### 对 Spec 的两处显式偏离（已定案，勿在执行时"纠正"）

1. **C2「按书指定」→ 全局规则**：默认导入建新书，按书规则在新书流程里无处挂载；全局 settings 单键覆盖主场景。需要按书时再迁 `books` 列。
2. **C4 查重只对「并入当前书」路径生效**：默认建新书无重复可比对象。且 `content_hash` 只在本功能上线后的导入写入，旧章为 NULL 不参与比对。`// ponytail: 旧章无 hash 不查重；重导入或逐章保存可自然补齐`。

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src-tauri/Cargo.toml` | 改 | +regex +md5 |
| `src-tauri/src/porting/import.rs` | 改 | 自定义规则加载/应用、`split_txt_with`、文件夹导入、hash 写入 |
| `src-tauri/src/commands.rs` | 改 | `preview_import` 加 State、新 `preview_import_dir`/`check_duplicates` 命令 |
| `src-tauri/src/repo/chapters.rs` | 改 | `hashes_for_book`/`set_hash` |
| `src-tauri/src/repo/foreshadows.rs` + `models.rs` | 改 | 伏笔两新列读写 |
| `src-tauri/migrations/0011_m4_import_dedup.sql` | 建 | content_hash |
| `src-tauri/migrations/0012_m4_foreshadow_repay.sql` | 建 | override_note / repay_chapter_id |
| `src/lib/tauri.ts` | 改 | previewImportDir / checkDuplicates 绑定、Foreshadow 类型 |
| `src/components/settings/ImportPane.tsx` + `.test.tsx` | 建 | 规则 CRUD 页 |
| `src/components/settings/SettingsModal.tsx` | 改 | TABS + 导入 |
| `src/components/io/ImportWizard.tsx` + `.test.tsx` | 改 | 选文件夹入口、疑似重复标注 |
| `src/components/foreshadow/urgency.ts` + `urgency.test.ts` | 改/建 | repayIdx 合约 |
| `src/components/foreshadow/ForeshadowPanel.tsx` | 改 | 还债章/备注表单 + 徽章 |
| `src/components/editor/PlaceholderDialog.tsx` + `.test.tsx` | 建 | 占位符扫描 |
| `src/components/editor/ChapterEditor.tsx` | 改 | 「检查」下拉两项 |
| `src/themes/defs.ts` / `ThemeProvider.tsx` / `styles.css` / `App.tsx` | 改 | `--bg-backdrop` 派生与应用 |
| `.tmp-zen-ref/verify.mjs` | 改 | 修复还原断言顺序 |

---

### Task 1: 自定义分章正则——Rust 侧（C2）

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/porting/import.rs`
- Modify: `src-tauri/src/commands.rs:327`（`preview_import` 命令）

**Interfaces:**
- Produces: `pub fn load_custom_rules(s: &AppState) -> Vec<regex::Regex>`；`pub fn split_txt_with(text: &str, custom: &[regex::Regex]) -> Vec<ParsedChapter>`（`split_txt` 保持原签名=空规则版）；`preview_import` 命令签名变为 `(s: State<AppState>, path: String)`。settings 键名 `customChapterRules`，JSON `[{"name":"…","pattern":"…"}]`——Task 2 前端按此读写。

- [ ] **Step 1: 写失败测试**

在 `import.rs` 末尾追加（该文件目前没有测试模块，新建）：

```rust
#[cfg(test)]
mod custom_rule_tests {
    use super::*;

    fn rules(pats: &[&str]) -> Vec<regex::Regex> {
        pats.iter().map(|p| regex::Regex::new(p).unwrap()).collect()
    }

    #[test]
    fn custom_rule_splits_where_builtins_do_not() {
        let text = "开头一段。\n【风起】\n风起了。\n【云落】\n云散了。";
        let out = split_txt_with(text, &rules(&["^【.+】$"]));
        assert_eq!(out.len(), 2, "两条自定义章题行各开一章: {out:?}");
        assert_eq!(out[0].title, "【风起】");
        assert_eq!(out[1].title, "【云落】");
    }

    #[test]
    fn custom_rules_respect_sentence_and_length_guards() {
        // 句读结尾的行即便是规则命中也不是标题（guard 先于自定义规则）
        let out = split_txt_with("【风起。】\n正文", &rules(&["^【.+】$"]));
        assert_eq!(out.len(), 1, "以句号结尾的行不切章: {out:?}");
        // 超长行同理（>40 字符）
        let long = format!("【{}】", "很".repeat(50));
        let out2 = split_txt_with(&format!("{long}\n正文"), &rules(&["^【.+】$"]));
        assert_eq!(out2.len(), 1);
    }

    #[test]
    fn load_custom_rules_reads_settings_and_skips_invalid() {
        let tmp = tempfile::tempdir().unwrap();
        let s = crate::state::AppState::test_state(tmp.path());
        commands::setting_set_inner(
            &s,
            "customChapterRules",
            r#"[{"name":"卷头","pattern":"^卷[一二三]$"},{"name":"坏","pattern":"("}]"#,
        )
        .unwrap();
        let rs = load_custom_rules(&s);
        assert_eq!(rs.len(), 1, "坏正则跳过不炸: {rs:?}");

        // 无配置 / 坏 JSON → 空
        commands::setting_set_inner(&s, "customChapterRules", "{{{").unwrap();
        assert!(load_custom_rules(&s).is_empty());
    }
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml custom_rule`
Expected: 编译失败（`split_txt_with`/`load_custom_rules` 未定义）。

- [ ] **Step 3: 实现**

`Cargo.toml` `[dependencies]` 追加：

```toml
regex = "1.11"
```

`import.rs`：`use` 区补 `use regex::Regex;` 和 `use crate::state::AppState;`（后者已在）。文件常量区追加：

```rust
/// 自定义分章规则（settings 表 customChapterRules 键）。行内命中即视为章题行，
/// 但仍先过句读/长度两条 guard（guard 是普适防误切，用户规则只加覆盖不豁免）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomChapterRule {
    pub name: String,
    pub pattern: String,
}

/// 规则数/长度上限：设置值可被外部 db 写入，信任边界处兜底防正则炸裂
pub const CUSTOM_RULES_MAX: usize = 20;
pub const CUSTOM_RULE_PATTERN_MAX: usize = 200;

pub fn load_custom_rules(s: &AppState) -> Vec<Regex> {
    let raw = commands::setting_get_inner(s, "customChapterRules")
        .ok()
        .flatten()
        .unwrap_or_default();
    let Ok(list) = serde_json::from_str::<Vec<CustomChapterRule>>(&raw) else {
        return Vec::new();
    };
    list.into_iter()
        .take(CUSTOM_RULES_MAX)
        .filter(|r| !r.pattern.is_empty() && r.pattern.len() <= CUSTOM_RULE_PATTERN_MAX)
        .filter_map(|r| Regex::new(&r.pattern).ok())
        .collect()
}
```

签名改造（逐一传参，行为不变处从简）：

```rust
fn heading_of(line: &str, custom: &[Regex]) -> Option<String> {
    // —— 函数体开头两条 guard 原样保留（长度 / 句读结尾）——
    // 在 SPECIAL_MARKERS 判定之后、`None` 之前追加：
    if custom.iter().any(|r| r.is_match(line)) {
        return Some(truncate_chars(line, TITLE_MAX_CHARS));
    }
    None
}
```

`split_segment(segment: &str, custom: &[Regex])`（`heading_of(trimmed, custom)` 一处调用点改参）；`split_txt` 拆成两个：

```rust
pub fn split_txt(text: &str) -> Vec<ParsedChapter> {
    split_txt_with(text, &[])
}

pub fn split_txt_with(text: &str, custom: &[Regex]) -> Vec<ParsedChapter> {
    text.split('\u{feff}')
        .filter(|s| !s.trim().is_empty())
        .flat_map(|s| split_segment(s, custom))
        .collect()
}
```

`import_docx(bytes: &[u8], custom: &[Regex])`（尾部 `split_txt(&text)` → `split_txt_with(&text, custom)`）；`preview_import_inner(path: &Path, custom: &[Regex])`（内部两个分支都传 `custom`）。

`commands.rs` 的 `preview_import` 命令改为带 State：

```rust
#[tauri::command]
pub fn preview_import(s: State<AppState>, path: String) -> AppResult<Vec<porting::import::ParsedChapter>> {
    let rules = porting::import::load_custom_rules(&s);
    porting::import::preview_import_inner(std::path::Path::new(&path), &rules)
}
```

（保留原 `#[tauri::command]` 之上的既有属性/注释；`import_docx` 的其它调用点若有，传 `&[]`。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: 全绿（含既有测试）。

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/porting/import.rs src-tauri/src/commands.rs
git commit -m "feat: 自定义分章正则 Rust 侧——settings 规则编译进 preview 分章"
```

---

### Task 2: 设置→导入 页（C2 前端）

**Files:**
- Create: `src/components/settings/ImportPane.tsx`
- Create: `src/components/settings/ImportPane.test.tsx`
- Modify: `src/components/settings/SettingsModal.tsx:13`（TABS）

**Interfaces:**
- Consumes: Task 1 的 settings 键 `customChapterRules`（JSON `[{"name","pattern"}]`）；`api.settingGet/settingSet`（`lib/tauri.ts:188` 已有）。

- [ ] **Step 1: 写失败测试**

`ImportPane.test.tsx`：

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImportPane } from "./ImportPane";
import { api } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: { settingGet: vi.fn(), settingSet: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.settingGet).mockResolvedValue(null);
  vi.mocked(api.settingSet).mockReset();
});

describe("ImportPane 自定义分章规则", () => {
  it("已存规则回显；删除后落库空数组", async () => {
    vi.mocked(api.settingGet).mockResolvedValue('[{"name":"卷头","pattern":"^卷一$"}]');
    render(createElement(ImportPane));
    expect(await screen.findByDisplayValue("^卷一$")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("删除"));
    expect(api.settingSet).toHaveBeenCalledWith("customChapterRules", "[]");
  });

  it("无效正则拒绝并提示，不入库", async () => {
    render(createElement(ImportPane));
    fireEvent.change(screen.getByPlaceholderText("规则名"), { target: { value: "坏" } });
    fireEvent.change(screen.getByPlaceholderText("如：^【.+】$"), { target: { value: "(" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(await screen.findByText(/正则无效/)).toBeInTheDocument();
    expect(api.settingSet).not.toHaveBeenCalled();
  });

  it("添加合法规则即落库并清空输入", async () => {
    render(createElement(ImportPane));
    fireEvent.change(screen.getByPlaceholderText("规则名"), { target: { value: "卷头" } });
    fireEvent.change(screen.getByPlaceholderText("如：^【.+】$"), { target: { value: "^卷[一二三]$" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(await screen.findByDisplayValue("^卷[一二三]$")).toBeInTheDocument();
    expect(api.settingSet).toHaveBeenCalledWith(
      "customChapterRules",
      '[{"name":"卷头","pattern":"^卷[一二三]$"}]',
    );
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/components/settings/ImportPane.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现**

`ImportPane.tsx`：

```tsx
import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api } from "../../lib/tauri";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

// 设置→导入：自定义分章正则（全局，settings 表 customChapterRules 键）。
// Rust 侧 preview_import 时编译应用——行内命中即视为章题行（内置 guard 仍先生效）。
// 按书指定是 spec 原文，此处有意做成全局：默认导入建新书，按书规则无处挂载。
const KEY = "customChapterRules";

interface Rule {
  name: string;
  pattern: string;
}

export function ImportPane() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [name, setName] = useState("");
  const [pattern, setPattern] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void api.settingGet(KEY).then((raw) => {
      if (!raw) return;
      try {
        setRules(JSON.parse(raw));
      } catch {
        // 坏数据当无规则
      }
    });
  }, []);

  const persist = (next: Rule[]) => {
    setRules(next);
    void api.settingSet(KEY, JSON.stringify(next));
  };

  const add = () => {
    const n = name.trim();
    const p = pattern.trim();
    if (!n || !p) {
      setErr("名称和正则都要填");
      return;
    }
    try {
      new RegExp(p);
    } catch (e) {
      setErr(`正则无效：${e}`);
      return;
    }
    if (p.length > 200) {
      setErr("正则过长（≤200 字符）");
      return;
    }
    if (rules.length >= 20) {
      setErr("最多 20 条规则");
      return;
    }
    setErr(null);
    persist([...rules, { name: n, pattern: p }]);
    setName("");
    setPattern("");
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
        自定义分章规则：行内命中即作为章题行（建议 ^…$ 锚定整行）。导入预览时与内置规则一起生效。
      </div>
      {rules.map((r, i) => (
        <div
          key={i}
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] px-2.5 py-1.5"
        >
          <span className="w-24 shrink-0 truncate text-sm text-[color:var(--text-primary)]">{r.name}</span>
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-[color:var(--text-secondary)]">{r.pattern}</code>
          <button
            onClick={() => persist(rules.filter((_, j) => j !== i))}
            title="删除"
            className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:text-[color:var(--danger)]"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      {err && <div className="text-xs text-[color:var(--danger)]">{err}</div>}
      <div className="grid grid-cols-[6rem_1fr_auto] items-center gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="规则名" />
        <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="如：^【.+】$" invalid={!!err} />
        <Button onClick={add}>
          <Plus size={14} />
          添加
        </Button>
      </div>
    </div>
  );
}
```

`SettingsModal.tsx` 的 TABS 数组加一项（外观之后）：

```ts
const TABS = [
  { id: "agent", label: "Agent" },
  { id: "appearance", label: "外观" },
  { id: "import", label: "导入" },
  { id: "provider", label: "AI 服务商" },
] as const;
```

渲染分支加 `{tab === "import" && <ImportPane />}`，顶部补 import。`SettingsTab` 类型由 TABS 推导自动扩展。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run src/components/settings` && `npx tsc --noEmit`
Expected: PASS / 无错。

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ImportPane.tsx src/components/settings/ImportPane.test.tsx src/components/settings/SettingsModal.tsx
git commit -m "feat: 设置新增导入页——自定义分章正则增删改"
```

---

### Task 3: 文件夹成书导入（C3）

**Files:**
- Modify: `src-tauri/src/porting/import.rs`
- Modify: `src-tauri/src/commands.rs`
- Modify: `src/lib/tauri.ts:158`
- Modify: `src/components/io/ImportWizard.tsx:28`（choose 旁）
- Test: `src-tauri/src/porting/import.rs`（测试模块）、`src/components/io/ImportWizard.test.tsx`

**Interfaces:**
- Produces: `pub fn preview_import_dir_inner(path: &Path) -> AppResult<Vec<ParsedChapter>>`；命令 `preview_import_dir(path: String) -> Vec<ParsedChapter>`；前端 `api.previewImportDir(path: string)`。

- [ ] **Step 1: 写失败测试（Rust）**

测试模块追加：

```rust
#[test]
fn nat_cmp_sorts_numbers_numerically() {
    let mut names = vec!["10.md".to_string(), "2.md".to_string(), "1.md".to_string()];
    names.sort_by(|a, b| nat_cmp(a, b));
    assert_eq!(names, vec!["1.md", "2.md", "10.md"]);
}

#[test]
fn strip_serial_variants() {
    assert_eq!(strip_serial("001 风雪"), "风雪");
    assert_eq!(strip_serial("001"), "001", "剥完为空则保留原名");
    assert_eq!(strip_serial("第12章 风雪"), "风雪");
    assert_eq!(strip_serial("第十二章-风雪"), "风雪");
    assert_eq!(strip_serial("楔子"), "楔子");
}

#[test]
fn preview_import_dir_orders_and_titles() {
    let tmp = tempfile::tempdir().unwrap();
    let dir = tmp.path().join("book");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("10.md"), "第十章正文\n\n第二段").unwrap();
    std::fs::write(dir.join("2.txt"), "第二章正文").unwrap();
    std::fs::write(dir.join("封面.png"), b"png").unwrap(); // 非文本跳过
    std::fs::write(dir.join("001 开端.md"), "开端正文").unwrap();
    let out = preview_import_dir_inner(&dir).unwrap();
    assert_eq!(
        out.iter().map(|c| c.title.as_str()).collect::<Vec<_>>(),
        vec!["开端", "第二章正文", "第十章正文"],
        "自然序排列，文件名去序号/去第X章前缀作章题"
    );
    assert!(out[0].content.contains("开端正文"));
}
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml nat_cmp strip_serial preview_import_dir`
Expected: 编译失败（函数未定义）。

- [ ] **Step 3: 实现（Rust）**

`import.rs` 追加：

```rust
/// 自然序比较：连续数字段按数值比、其余按字符比（"2" < "10"，folderBook 同款）
fn nat_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    use std::cmp::Ordering;
    let (mut a, mut b) = (a, b);
    loop {
        let (ad, bd) = (a.chars().next(), b.chars().next());
        match (ad, bd) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let na = take_digits_run(&mut a);
                let nb = take_digits_run(&mut b);
                let (za, zb) = (na.trim_start_matches('0'), nb.trim_start_matches('0'));
                let ord = za.len().cmp(&zb.len()).then_with(|| za.cmp(zb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                if x != y {
                    return x.cmp(&y);
                }
                a = &a[x.len_utf8()..];
                b = &b[y.len_utf8()..];
            }
        }
    }
}

fn take_digits_run(s: &mut &str) -> String {
    let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
    let (run, rest) = s.split_at(end);
    *s = rest;
    run.to_string()
}

/// 文件名去序号作章题：剥前导数字串+分隔符，再剥「第X章」式前缀；剥完为空保留原名
fn strip_serial(stem: &str) -> String {
    let s = stem.trim();
    let no_digits = s.trim_start_matches(|c: char| is_digit(c));
    let no_digits = no_digits.trim_start_matches(['.', '．', '、', '-', '_', ' ', '\u{3000}']);
    let step1 = if no_digits.is_empty() { s } else { no_digits };
    if let Some(rest) = step1.strip_prefix('第') {
        if let Some((ui, uc)) = rest
            .char_indices()
            .find(|(_, c)| matches!(c, '章' | '卷' | '回' | '集' | '部' | '篇'))
        {
            let mid = &rest[..ui];
            let after = rest[ui + uc.len_utf8()..]
                .trim_start_matches(['.', '．', '、', '-', '_', ' ', '\u{3000}', ':', '：']);
            if !mid.is_empty() && mid.chars().all(is_numeral) && !after.is_empty() {
                return truncate_chars(after, TITLE_MAX_CHARS);
            }
        }
    }
    truncate_chars(step1, TITLE_MAX_CHARS)
}

/// 文件夹成书导入：*.md / *.txt 按文件名自然序，一文件一章。
/// 不递归子目录；docx 不收（二进制混排无意义）。
pub fn preview_import_dir_inner(path: &Path) -> AppResult<Vec<ParsedChapter>> {
    let mut entries: Vec<(String, std::path::PathBuf)> = std::fs::read_dir(path)?
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let p = e.path();
            let ext = p.extension()?.to_str()?.to_ascii_lowercase();
            if ext != "md" && ext != "txt" {
                return None;
            }
            Some((p.file_stem()?.to_str()?.to_string(), p))
        })
        .collect();
    entries.sort_by(|a, b| nat_cmp(&a.0, &b.0));
    let mut out = Vec::new();
    for (stem, p) in entries {
        let bytes = std::fs::read(&p)?;
        let content = normalize_paragraphs(&trim_blank(&detect_and_decode(&bytes)));
        if content.is_empty() {
            continue;
        }
        out.push(ParsedChapter { title: strip_serial(&stem), content, volume: None });
    }
    Ok(out)
}
```

`commands.rs` 加命令（贴着 `preview_import`）：

```rust
#[tauri::command]
pub fn preview_import_dir(path: String) -> AppResult<Vec<porting::import::ParsedChapter>> {
    porting::import::preview_import_dir_inner(std::path::Path::new(&path))
}
```

并确认命令已注册进 `tauri::Builder` 的 `invoke_handler` 列表（同文件内既有命令的注册处，追加同名项）。

- [ ] **Step 4: 跑 Rust 测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

- [ ] **Step 5: 前端绑定 + 入口**

`lib/tauri.ts` `previewImport` 行旁加：

```ts
previewImportDir: (path: string) => invoke<ParsedChapter[]>("preview_import_dir", { path }),
```

`ImportWizard.tsx`：lucide import 加 `FolderOpen`；`choose` 之后加：

```tsx
const chooseDir = async () => {
  try {
    const sel = await open({ directory: true });
    if (typeof sel !== "string") return;
    setFileName(`${sel.split(/[\\/]/).pop() ?? sel}（文件夹）`);
    setReport(null);
    const parsed = await api.previewImportDir(sel);
    setItems(parsed);
    setPicked(new Set(parsed.map((_, i) => i)));
    setError(parsed.length === 0 ? "文件夹里没有可导入的 .md/.txt 文件" : null);
  } catch (e) {
    setItems([]);
    setPicked(new Set());
    setError(String(e));
  }
};
```

「选择文件」按钮旁并排加：

```tsx
<button
  onClick={() => void chooseDir()}
  className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
>
  <FolderOpen size={13} />
  选文件夹
</button>
```

`ImportWizard.test.tsx` 追加一例（沿用该文件既有的 api mock 方式；若其 mock 对象按需提供，补 `previewImportDir`）：

```tsx
it("选文件夹：目录选择后走 previewImportDir 并全选", async () => {
  vi.mocked(api.previewImportDir).mockResolvedValue([
    { title: "开端", content: "正文一", volume: null },
  ]);
  render(createElement(ImportWizard, { bookId: null, onClose: () => {}, onImported: () => {} }));
  fireEvent.click(screen.getByRole("button", { name: /选文件夹/ }));
  expect(await screen.findByText("开端")).toBeInTheDocument();
  expect(api.previewImportDir).toHaveBeenCalled();
});
```

（plugin-dialog 的 `open` 若该测试文件已 mock，补 `directory: true` 分支返回固定路径；未 mock 则加 `vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:/book") }))`。）

- [ ] **Step 6: 跑前端测试 + tsc**

Run: `npx vitest run src/components/io` && `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/porting/import.rs src-tauri/src/commands.rs src/lib/tauri.ts src/components/io/ImportWizard.tsx src/components/io/ImportWizard.test.tsx
git commit -m "feat: 文件夹成书导入——一文件一章自然序合成"
```

---

### Task 4: 导入查重（C4）

**Files:**
- Create: `src-tauri/migrations/0011_m4_import_dedup.sql`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/repo/chapters.rs`
- Modify: `src-tauri/src/porting/import.rs`（import_chapters_inner 写 hash）
- Modify: `src-tauri/src/commands.rs`（新命令）
- Modify: `src/lib/tauri.ts`
- Modify: `src/components/io/ImportWizard.tsx`
- Test: `src-tauri/src/commands.rs`（测试模块）

**Interfaces:**
- Produces: `repo::chapters::hashes_for_book(conn, book_id) -> AppResult<Vec<String>>`、`repo::chapters::set_hash(conn, id, hash)`；`import.rs` 的 `pub fn content_md5(c: &str) -> String`；命令 `check_duplicates(bookId: i64, contents: Vec<String>) -> Vec<bool>`；前端 `api.checkDuplicates(bookId, contents)`。

- [ ] **Step 1: 迁移 + 依赖**

`0011_m4_import_dedup.sql`：

```sql
-- M4 T4 导入查重：章内容 MD5（导入时写入；同书预览时比对）
ALTER TABLE chapters ADD COLUMN content_hash TEXT;
CREATE INDEX idx_chapters_book_hash ON chapters(book_id, content_hash);
```

`Cargo.toml` 追加 `md5 = "0.7"`。

- [ ] **Step 2: 写失败测试**

`commands.rs` 测试区（bg_tests 旁）加新模块：

```rust
#[cfg(test)]
mod import_dedup_tests {
    use super::*;
    use crate::porting::import::{content_md5, import_chapters_inner, ParsedChapter};

    fn setup() -> (tempfile::TempDir, AppState) {
        let tmp = tempfile::tempdir().unwrap();
        let state = AppState::test_state(tmp.path());
        (tmp, state)
    }

    fn ch(title: &str, content: &str) -> ParsedChapter {
        ParsedChapter { title: title.into(), content: content.into(), volume: None }
    }

    #[test]
    fn duplicates_flagged_within_same_book_only() {
        let (tmp, s) = setup();
        let bid = commands::create_book_inner(&s, "测试书").unwrap().id;
        import_chapters_inner(&s, bid, &[ch("一", "同样的内容"), ch("二", "别的内容")]).unwrap();

        let flags = check_duplicates_inner(&s, bid, &["同样的内容".into(), "第三种".into()]).unwrap();
        assert_eq!(flags, vec![true, false], "同书已有 hash 命中即疑似重复");

        let bid2 = commands::create_book_inner(&s, "另一本书").unwrap().id;
        let flags2 = check_duplicates_inner(&s, bid2, &["同样的内容".into()]).unwrap();
        assert_eq!(flags2, vec![false], "查重范围=目标书，跨书不误报");
    }

    #[test]
    fn imported_chapters_carry_hash() {
        let (tmp, s) = setup();
        let bid = commands::create_book_inner(&s, "哈希书").unwrap().id;
        import_chapters_inner(&s, bid, &[ch("一", "内容甲")]).unwrap();
        let hashes = repo::chapters::hashes_for_book(&*lock(&s).unwrap(), bid).unwrap();
        assert_eq!(hashes, vec![content_md5("内容甲")]);
    }
}
```

（`create_book_inner` 的确切返回字段以现有代码为准——若返回 `Book` 取 `.id`，若返回 id 直接用；`lock` 已在 `commands.rs` 顶层。）

- [ ] **Step 3: 跑测试确认失败**

Run: `cargo test --manifest-path src-tauri/Cargo.toml import_dedup`
Expected: 编译失败。

- [ ] **Step 4: 实现（Rust）**

`repo/chapters.rs` 追加（对齐该模块既有函数签名风格）：

```rust
/// 同书未删章的 content_hash（NULL 不含）
pub fn hashes_for_book(conn: &Connection, book_id: i64) -> AppResult<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT content_hash FROM chapters \
         WHERE book_id = ?1 AND deleted_at IS NULL AND content_hash IS NOT NULL",
    )?;
    let rows = stmt.query_map([book_id], |r| r.get::<_, String>(0))?;
    Ok(rows.filter_map(|r| r.ok()).collect())
}

pub fn set_hash(conn: &Connection, id: i64, hash: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chapters SET content_hash = ?1 WHERE id = ?2",
        rusqlite::params![hash, id],
    )?;
    Ok(())
}
```

`import.rs` 追加并在 `import_chapters_inner` 的 `touch_content` 之后调用：

```rust
pub fn content_md5(c: &str) -> String {
    format!("{:x}", md5::compute(c.as_bytes()))
}
```

```rust
// import_chapters_inner 循环内，touch_content 那行之后：
let hash = content_md5(&p.content);
lock(s).and_then(|conn| repo::chapters::set_hash(&*conn, id, &hash))?;
```

`commands.rs` 命令 + inner：

```rust
pub fn check_duplicates_inner(s: &AppState, book_id: i64, contents: &[String]) -> AppResult<Vec<bool>> {
    let known: std::collections::HashSet<String> =
        repo::chapters::hashes_for_book(&*lock(s)?, book_id)?.into_iter().collect();
    Ok(contents.iter().map(|c| known.contains(&porting::import::content_md5(c))).collect())
}

#[tauri::command]
pub fn check_duplicates(s: State<AppState>, bookId: i64, contents: Vec<String>) -> AppResult<Vec<bool>> {
    check_duplicates_inner(&s, bookId, &contents)
}
```

（wire 惯例：命令参数前端 camelCase；注册进 invoke_handler。）

- [ ] **Step 5: 跑 Rust 测试确认通过**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

- [ ] **Step 6: 前端标注**

`lib/tauri.ts` 加：

```ts
checkDuplicates: (bookId: number, contents: string[]) =>
  invoke<boolean[]>("check_duplicates", { bookId, contents }),
```

`ImportWizard.tsx`：import `Badge`（`../ui/Badge`）；状态加 `const [dups, setDups] = useState<Set<number>>(new Set());`。`choose`/`chooseDir` 解析成功后统一走一段刷新逻辑（抽小函数或两处各贴）：

```tsx
const refreshDups = async (parsed: ParsedChapter[]) => {
  if (props.bookId == null) {
    setDups(new Set());
    return;
  }
  try {
    const flags = await api.checkDuplicates(
      props.bookId,
      parsed.map((p) => p.content),
    );
    setDups(new Set(flags.flatMap((dup, i) => (dup ? [i] : []))));
  } catch {
    setDups(new Set()); // 查重失败不阻断导入
  }
};
```

勾选初始化改为排除重复：`setPicked(new Set(parsed.map((_, i) => i).filter((i) => !dupFlags[i])))`——因 `refreshDups` 异步晚到，改为在 `choose` 内 await 它之后再按 `dups` 初始化（把上面函数改为返回 `Set<number>` 同步使用）。章行渲染加：

```tsx
{dups.has(i) && <Badge tone="amber">疑似重复</Badge>}
```

（放在行尾字数 `<span>` 之后。）

`ImportWizard.test.tsx` 追加：

```tsx
it("并入当前书时疑似重复章默认不勾选并标徽章", async () => {
  vi.mocked(api.previewImport).mockResolvedValue([
    { title: "旧章", content: "已有内容", volume: null },
    { title: "新章", content: "新内容", volume: null },
  ]);
  vi.mocked(api.checkDuplicates).mockResolvedValue([true, false]);
  render(createElement(ImportWizard, { bookId: 7, onClose: () => {}, onImported: () => {} }));
  fireEvent.click(screen.getByRole("button", { name: /选择文件/ }));
  expect(await screen.findByText("疑似重复")).toBeInTheDocument();
  const row = screen.getByText("旧章").closest("label")!;
  expect(row.querySelector("input")!.checked).toBe(false);
});
```

- [ ] **Step 7: 跑前端测试 + tsc**

Run: `npx vitest run src/components/io` && `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 8: Commit**

```bash
git add src-tauri/migrations/0011_m4_import_dedup.sql src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/repo/chapters.rs src-tauri/src/porting/import.rs src-tauri/src/commands.rs src/lib/tauri.ts src/components/io/ImportWizard.tsx src/components/io/ImportWizard.test.tsx
git commit -m "feat: 导入查重——内容 MD5 同书比对，疑似重复默认不选"
```

---

### Task 5: 伏笔还债登记（A2）

**Files:**
- Create: `src-tauri/migrations/0012_m4_foreshadow_repay.sql`
- Modify: `src-tauri/src/models.rs`（Foreshadow 结构）
- Modify: `src-tauri/src/repo/foreshadows.rs`
- Modify: `src/lib/tauri.ts`（Foreshadow 类型 + create/update 参数）
- Modify: `src/components/foreshadow/urgency.ts`
- Create: `src/components/foreshadow/urgency.test.ts`
- Modify: `src/components/foreshadow/ForeshadowPanel.tsx`

**Interfaces:**
- Produces: `foreshadows.override_note TEXT NOT NULL DEFAULT ''`、`foreshadows.repay_chapter_id INTEGER`；`urgencyOf` 入参加 `repayIdx?: number | null`、返回值加 `registered: boolean`。

- [ ] **Step 1: 迁移**

`0012_m4_foreshadow_repay.sql`：

```sql
-- M4 T5 伏笔还债登记（A2 Override 合约）：放行需登记还债章与理由
ALTER TABLE foreshadows ADD COLUMN override_note TEXT NOT NULL DEFAULT '';
ALTER TABLE foreshadows ADD COLUMN repay_chapter_id INTEGER;
```

- [ ] **Step 2: 写失败测试**

`urgency.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { urgencyOf } from "./urgency";

const base = { status: "active", plantedIdx: 0, currentIdx: 10 };

describe("还债登记（repayIdx）合约", () => {
  it("未登记：过计划回收章即超期", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 10 });
    expect(r.state).toBe("overdue");
    expect(r.registered).toBe(false);
  });

  it("已登记：倒计时改按还债章算，未到不超期", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 10, repayIdx: 20 });
    expect(r.state).not.toBe("overdue");
    expect(r.remaining).toBe(10);
    expect(r.registered).toBe(true);
  });

  it("已登记但过了还债章：重新超期（债没还继续催）", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 25, repayIdx: 20 });
    expect(r.state).toBe("overdue");
  });

  it("还债章临期 ≤5 章进紧急", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 16, repayIdx: 20 });
    expect(r.state).toBe("urgent");
  });

  it("resolved/dropped 终态不受登记影响", () => {
    expect(urgencyOf({ ...base, status: "resolved", targetIdx: 5, repayIdx: 20 }).state).toBe("resolved");
    expect(urgencyOf({ ...base, status: "dropped", targetIdx: 5, repayIdx: 20 }).state).toBe("dropped");
  });
});
```

Run: `npx vitest run src/components/foreshadow/urgency.test.ts`
Expected: FAIL（`registered` 不存在 / repay 不生效——`已登记：未到不超期` 一例会红）。

- [ ] **Step 3: 实现 urgency**

`urgency.ts` 整体替换 `urgencyOf`（FORESHADOW_TONE 不动）：

```ts
export function urgencyOf(f: {
  status: string;
  plantedIdx: number; // 埋设章序（章被软删时传 -1，展示层特判「章已删」）
  targetIdx: number | null; // 计划回收章序（null=未定）
  currentIdx: number; // 当前章序
  /** 已登记还债章（M4 T5 放行合约）：倒计时与超期改按它算 */
  repayIdx?: number | null;
}): { state: ForeshadowState; remaining: number | null; score: number; registered: boolean } {
  const registered = f.repayIdx != null;
  // 已登记 → 还债章就是新的截止；未登记 → 原计划回收章
  const deadline = registered ? f.repayIdx! : f.targetIdx;
  const remaining = deadline != null ? deadline - f.currentIdx : null;
  const span = deadline != null ? deadline - f.plantedIdx : Number.NaN;
  const safe = span > 0 ? span : 1;
  const score = (f.currentIdx - f.plantedIdx) / safe;

  if (f.status === "resolved") return { state: "resolved", remaining, score, registered };
  if (f.status === "dropped") return { state: "dropped", remaining, score, registered };
  if (remaining != null && remaining < 0) return { state: "overdue", remaining, score, registered };
  if ((remaining != null && remaining <= 5) || score >= 2) return { state: "urgent", remaining, score, registered };
  return { state: "active", remaining, score, registered };
}
```

Run: `npx vitest run src/components/foreshadow/urgency.test.ts` → PASS。

- [ ] **Step 4: Rust 列贯通**

`models.rs` 的 Foreshadow 结构加（serde 与既有字段同风格）：

```rust
#[serde(default)]
pub override_note: String,
#[serde(default)]
pub repay_chapter_id: Option<i64>,
```

`repo/foreshadows.rs`：行映射（SELECT 列表 + `row.get`）、INSERT、UPDATE 三处补 `override_note`/`repay_chapter_id`（按该文件既有 SQL 风格逐处补列）。`lib/tauri.ts` 的 Foreshadow 类型加 `override_note: string; repay_chapter_id: number | null;`，create/update 调用处参数同步带新字段。

- [ ] **Step 5: 面板 UI**

`ForeshadowPanel.tsx`：

1. 调 `urgencyOf` 处（约 :102）入参加 `repayIdx: repayIdxOf(f)`——即 `f.repay_chapter_id == null ? null : 章序`（与现有 `targetIdx` 由 `target_chapter_id` 解析章序的写法完全同款，紧挨着加一行）。
2. 编辑表单（现有「计划回收章」选择器旁）加：

```tsx
{/* 还债章：登记后紧急度改按它倒计时（M4 T5 放行合约） */}
<select
  value={form.repay_chapter_id ?? ""}
  onChange={(e) => setForm({ ...form, repay_chapter_id: e.target.value ? Number(e.target.value) : null })}
  className="rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-sm text-[color:var(--text-primary)]"
>
  <option value="">未登记还债章</option>
  {chapters.map((c, i) => (
    <option key={c.id} value={c.id}>
      第{i + 1}章 · {c.title}
    </option>
  ))}
</select>
<Input
  value={form.override_note}
  onChange={(e) => setForm({ ...form, override_note: e.target.value })}
  placeholder="放行理由（如：并到第二卷高潮一起收）"
/>
```

（`form` 即该文件现有的编辑表单 state，初始化/提交对象里补两个新字段；`Input` 从 `../ui/Input` 引入；select 选项列表复用「计划回收章」现成的章列表变量。）

3. 列表行徽章区（现有紧急度 Badge 旁）加：

```tsx
{r.registered && (
  <Badge tone="neutral" title={`已登记还债：${f.override_note || "未填理由"}`}>
    已登记还债
  </Badge>
)}
```

Run: `npx vitest run src/components/foreshadow` && `npx tsc --noEmit` && `cargo test --manifest-path src-tauri/Cargo.toml`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src-tauri/migrations/0012_m4_foreshadow_repay.sql src-tauri/src/models.rs src-tauri/src/repo/foreshadows.rs src/lib/tauri.ts src/components/foreshadow
git commit -m "feat: 伏笔还债登记——放行需登记还债章，紧急度按新截止算"
```

---

### Task 6: 占位符扫描（D3）

**Files:**
- Create: `src/components/editor/PlaceholderDialog.tsx`
- Create: `src/components/editor/PlaceholderDialog.test.tsx`
- Modify: `src/components/editor/ChapterEditor.tsx:206`（检查按钮改下拉）

**Interfaces:**
- Produces: `export function scanPlaceholders(md: string): PlaceholderHit[]`（`{line, text, label}`）；`<PlaceholderDialog content onClose />`。

- [ ] **Step 1: 写失败测试**

`PlaceholderDialog.test.tsx`：

```tsx
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { PlaceholderDialog, scanPlaceholders } from "./PlaceholderDialog";

describe("scanPlaceholders", () => {
  it("四类占位符全命中，带行号", () => {
    const md = "正常一句。\n这里有个[待补充：武功名]，还有（暂名）。\n再一个{主角旧姓}和【待改】。";
    const hits = scanPlaceholders(md);
    expect(hits.map((h) => h.text)).toEqual(["[待补充：武功名]", "（暂名）", "{主角旧姓}", "【待改】"]);
    expect(hits[0].line).toBe(2);
  });

  it("普通括号与句子不误报", () => {
    expect(scanPlaceholders("他说（笑）了句话。")).toEqual([]);
    expect(scanPlaceholders("数组 arr[0] 取值")).toEqual([]);
  });
});

describe("PlaceholderDialog", () => {
  it("空结果与命中两态", () => {
    const { rerender } = render(createElement(PlaceholderDialog, { content: "干净正文", onClose: () => {} }));
    expect(screen.getByText(/未发现占位符/)).toBeInTheDocument();
    rerender(createElement(PlaceholderDialog, { content: "看[待定]", onClose: () => {} }));
    expect(screen.getByText(/发现 1 处占位符/)).toBeInTheDocument();
    expect(screen.getByText("[待定]")).toBeInTheDocument();
  });
});
```

Run: `npx vitest run src/components/editor/PlaceholderDialog.test.tsx`
Expected: FAIL（模块不存在）。

- [ ] **Step 2: 实现**

`PlaceholderDialog.tsx`：

```tsx
import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";

// M4 T6 占位符扫描（webnovel-writer placeholder_scanner 移植）：
// 写前阻断——四类占位符命中即列出（章内 markdown 行号），替换完再交稿。
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\[待[^\]\n]*\]/g, label: "[待…]" },
  { re: /（暂名[^）\n]*）|\(暂名[^)\n]*\)/g, label: "（暂名）" },
  { re: /【待[^】\n]*】/g, label: "【待…】" },
  { re: /\{[^}\n]{1,30}\}/g, label: "{…}" }, // 限长防误吞正文
];

export interface PlaceholderHit {
  line: number;
  text: string;
  label: string;
}

export function scanPlaceholders(md: string): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  md.split("\n").forEach((line, i) => {
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of line.matchAll(p.re)) {
        hits.push({ line: i + 1, text: m[0], label: p.label });
      }
    }
  });
  return hits;
}

export function PlaceholderDialog(props: { content: string; onClose: () => void }) {
  const hits = scanPlaceholders(props.content);
  return (
    <Modal open onClose={props.onClose} title="占位符扫描" widthClass="max-w-lg" testId="placeholder-backdrop">
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-4 py-3 text-[11px] text-[color:var(--text-faint)]">
        {hits.length === 0 ? "未发现占位符，可以安心交稿" : `发现 ${hits.length} 处占位符——写完前请替换`}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {hits.map((h, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[color:var(--text-secondary)]"
          >
            <span className="w-10 shrink-0 text-right text-[11px] text-[color:var(--text-faint)]">{h.line} 行</span>
            <Badge tone="amber">{h.label}</Badge>
            <span className="min-w-0 flex-1 truncate">{h.text}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
```

Run: `npx vitest run src/components/editor/PlaceholderDialog.test.tsx` → PASS。

- [ ] **Step 3: 编辑器「检查」下拉**

`ChapterEditor.tsx`：import `PlaceholderDialog`；state 加 `const [checkOpen, setCheckOpen] = useState(false);` 与 `const [placeholderOpen, setPlaceholderOpen] = useState(false);`（紧挨现有 `sensitiveOpen`）。原「敏感词检查」按钮（:206-212）替换为下拉：

```tsx
<div className="relative">
  <button
    onClick={() => setCheckOpen((v) => !v)}
    title="检查"
    className={`rounded p-1 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
      checkOpen ? "text-[color:var(--accent)]" : ""
    }`}
  >
    <ScanSearch size={14} />
  </button>
  {checkOpen && (
    <>
      <div className="fixed inset-0 z-10" onClick={() => setCheckOpen(false)} />
      <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 text-xs [box-shadow:var(--shadow-pop)]">
        <button
          onClick={() => { setCheckOpen(false); setSensitiveOpen(true); }}
          className="block w-full px-3 py-1.5 text-left text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          敏感词检查
        </button>
        <button
          onClick={() => { setCheckOpen(false); setPlaceholderOpen(true); }}
          className="block w-full px-3 py-1.5 text-left text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          占位符扫描
        </button>
      </div>
    </>
  )}
</div>
```

渲染区（`SensitiveDialog` 条件渲染旁）加：

```tsx
{placeholderOpen && (
  <PlaceholderDialog content={currentMarkdown()} onClose={() => setPlaceholderOpen(false)} />
)}
```

Run: `npx vitest run src/components/editor` && `npx tsc --noEmit`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/components/editor/PlaceholderDialog.tsx src/components/editor/PlaceholderDialog.test.tsx src/components/editor/ChapterEditor.tsx
git commit -m "feat: 占位符扫描——检查下拉两项，写前阻断待补标记"
```

---

### Task 7: Zen 收尾——背板对比度 + 暗色实机核验

**Files:**
- Modify: `src/themes/defs.ts`（backdropOf）
- Modify: `src/themes/ThemeProvider.tsx:91`（themeCss）
- Modify: `src/styles.css`（:root 默认值）
- Modify: `src/App.tsx:83`（根背景换变量）
- Modify: `src/themes/themes.test.ts`
- Modify: `.tmp-zen-ref/verify.mjs`（还原断言顺序修复）

**Interfaces:**
- Produces: CSS 变量 `--bg-backdrop`（每主题派生：dark `mix(bg-base,#000,0.45)`、light `mix(bg-base,#000,0.9)`；默认主题值 `#0a0a0c` 在 styles.css :root）。

- [ ] **Step 1: 写失败测试**

`themes.test.ts` 的 `applyColorTheme` describe 里加：

```ts
it("themeCss 派生 --bg-backdrop 且默认主题由 :root 提供", () => {
  const css = themeCss(findTheme("matcha")!);
  expect(css).toContain("--bg-backdrop:");
  // 浅色：mix(#e4ece0,#000,0.9) → #cdd5c9 附近（手算容差：含前缀即可断言存在）
  expect(getComputedStyle(document.documentElement).getPropertyValue("--bg-backdrop")).toBe("");
});
```

（themeCss 需在文件顶部 import 里补上。）第二断言的语义：注入前 :root 无此变量——若 styles.css 已加则改为断言非空。执行时以"注入后读取到派生值"为准：

```ts
applyColorTheme("matcha");
expect(getComputedStyle(document.documentElement).getPropertyValue("--bg-backdrop").trim().length).toBeGreaterThan(0);
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run src/themes/themes.test.ts`
Expected: FAIL（无 --bg-backdrop）。

- [ ] **Step 3: 实现**

`defs.ts`（`mix` 已是模块内私有函数，直接用）在 THEMES 定义之后加：

```ts
/** 背板色：bg-base 再压暗一档，内容浮卡与窗口边框之间要有可感知的落差
 *  （Zen 的 chrome backdrop 比内容深；比例经实机核验定档） */
export function backdropOf(theme: ThemeDef): string {
  return mix(theme.vars["--bg-base"], "#000000", theme.dark ? 0.45 : 0.9);
}
```

`ThemeProvider.tsx` `themeCss` 改：

```ts
import { backdropOf, findTheme, ThemeDef, THEME_VAR_KEYS } from "./defs"; // 补 backdropOf

export function themeCss(theme: ThemeDef): string {
  const body = THEME_VAR_KEYS.map((k) => `${k}:${theme.vars[k]};`).join("");
  return `:root{${body}--bg-backdrop:${backdropOf(theme)};}`;
}
```

`styles.css` :root（`--tab-selected-bg` 旁）加：

```css
  /* 背板：窗口底色比内容浮卡再深一档（默认主题的 backdropOf 派生值） */
  --bg-backdrop: #0a0a0c;
```

（= `mix(#17171a, #000, 0.45)` 逐通道 23·0.45≈10、26·0.45≈12。）

`App.tsx:83` 根 div：`bg-[var(--bg-base)]` → `bg-[var(--bg-backdrop)]`。

Run: `npx vitest run src/themes` && `npx tsc --noEmit` → PASS。

- [ ] **Step 4: 重建 + 暗色实机核验（含 verify.mjs 修复）**

先修 `.tmp-zen-ref/verify.mjs` 第 10 检查的断言顺序 bug：**「使用中」徽章读取必须在 dispatch Escape 之前**（当前代码先关弹窗再读，永远拿到 "(settings closed)"）。把 `const cur = [...]` 那段移到 `window.dispatchEvent(...Escape)` 之前，并把选择器限定在 `[data-testid="settings-backdrop"] button` 范围内。

然后：

```powershell
Get-Process bixian -ErrorAction SilentlyContinue | Stop-Process -Force
npm run tauri build
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9222"
Start-Process -FilePath "D:\Mycraft\Bixian\src-tauri\target\release\bixian.exe"
```

用 `dockcheck.mjs` 同款 CDP 脚本核验（**先读当前主题（枫叶）存住，结尾还原**）：

- 切 墨岩/暗夜/午夜蓝/枫夜 各一次，断言 `getComputedStyle(documentElement)` 的 `--bg-backdrop` 与 `--bg-panel` 的 RGB 逐通道差 ≥ 8（背板确实更深且可感知）；
- `verify.mjs` 全量重跑应 10/10；
- `verify-p3.mjs` 重跑应 7/7；
- 各主题截图一张，肉眼确认浮卡边界。

- [ ] **Step 5: Commit**

```bash
git add src/themes/defs.ts src/themes/ThemeProvider.tsx src/styles.css src/App.tsx src/themes/themes.test.ts
git commit -m "feat: 背板对比度——--bg-backdrop 按主题派生，浮卡边界可感知"
```

---

## Self-Review 记录

1. **Spec 覆盖**：C2（Task 1+2，全局化偏离已声明）、C3（Task 3）、C4（Task 4，并入路径限定已声明）、A2（Task 5）、D3（Task 6）、Zen 收尾两项（Task 7）。无缺口。
2. **占位符扫描**：Task 5 Step 4 的 repo 三处补列未给完整 SQL（foreshadows.rs 未读）——执行时按该文件既有风格补，属机械操作；Task 4 Step 2 的 `create_book_inner` 返回形态以现码为准。其余步骤均含完整代码。
3. **类型一致性**：`previewImportDir`/`checkDuplicates` 前后端命名一致（wire camelCase）；`urgencyOf` 新增字段 `repayIdx`/`registered` 在 Task 5 测试与实现一致；`--bg-backdrop` 在 defs/ThemeProvider/styles/App 四处一致，默认值 #0a0a0c 与派生公式吻合。
