# 笔仙 M0 基础骨架 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建笔仙可运行的桌面骨架：Tauri 2 三栏布局 + 书籍/章节管理（md 文件真源）+ TipTap 编辑器自动保存 + SQLite 索引与 rescan 重建。

**Architecture:** Tauri 2 (WebView) + React 18/TS/Tailwind 4 前端；Rust 核心分层 commands → repo/fs_service → SQLite(rusqlite) 与磁盘 md。数据流铁律见规格书 §3：md 文件为正文唯一真源，SQLite 仅元数据。

**Tech Stack:** Tauri 2.x 稳定版、React、TypeScript、Tailwind 4、Zustand、react-resizable-panels、TipTap v2.26 + tiptap-markdown、rusqlite(bundled)、rusqlite_migration、Vitest + happy-dom、cargo test。

**Spec:** `docs/specs/2026-09-19-bixian-spec.md`（执行本计划前必读 §3 架构、§4 数据模型、§6 M0 验收标准）

## Global Constraints

- 版本：Rust stable 1.98 / Node 24 / pnpm 11；**Tauri 锁 2.x 稳定版（禁止 3.0-alpha）**；TipTap 全家桶锁 `^2.26.0`（v3 不兼容 tiptap-markdown）
- 命令参数：JS 侧 camelCase（Tauri 自动映射 Rust snake_case 形参）；**返回结构体字段保持 Rust 原始 snake_case**，TS 接口用同名字段
- 所有用户可见文案中文
- 每个 Task 结束时 `cargo test`、`pnpm test`、`pnpm build` 全绿才可 commit
- 依赖锁定：只引入本计划列出的依赖；版本漂移导致 API 不符时以锁定版官方文档为准，不擅自换库
- Commit 规范：`feat|fix|chore|test|docs: 中文描述`
- 环境：Windows 11 + git bash；WebView2 系统自带

---

### Task 1: 项目脚手架与工具链

**Files:**
- Create: CTA 模板生成的全部文件（src/、src-tauri/、package.json 等）
- Modify: `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`vite.config.ts`、`src/styles.css`

**Interfaces:**
- Produces: 可运行的空 Tauri 应用；包名 `bixian`；product name `Bixian`（窗口标题「笔仙」）；identifier `com.bixian.app`；vitest/happy-dom 测试栈就绪；Rust 侧依赖 rusqlite(bundled)/rusqlite_migration/serde/serde_json/thiserror + dev tempfile 已添加。后续所有任务在此结构上开发。

- [ ] **Step 1: 生成 Tauri React-TS 模板**（根目录非空，先在子目录生成再移入）

```bash
cd /d/Mycraft/Bixian
pnpm create tauri-app@latest bixian-scaffold --template react-ts --manager pnpm --identifier com.bixian.app --yes
# 移入根目录（CTA 拒绝非空目录，故先子目录后移动）
mv bixian-scaffold/* bixian-scaffold/.gitignore .
rmdir bixian-scaffold
```

注：若 `--yes` 标志不被当前 create-tauri-app 支持，交互提示时按 template=react-ts / manager=pnpm / identifier=com.bixian.app 选择。

- [ ] **Step 2: 改包名与产品名**

`package.json`：`"name": "bixian"`
`src-tauri/Cargo.toml`：`name = "bixian"`（lib 与 bin 同名）
`src-tauri/tauri.conf.json`：`"productName": "Bixian"`，`"windows"[*]` 增加 `"title": "笔仙"`，确认 `"identifier": "com.bixian.app"`

- [ ] **Step 3: 安装前端依赖与测试栈**

```bash
pnpm install
pnpm add tailwindcss @tailwindcss/vite zustand react-resizable-panels @tauri-apps/api
pnpm add -D vitest @testing-library/react @testing-library/jest-dom happy-dom
```

- [ ] **Step 4: 配置 Vite（Tailwind 4 + Vitest）**

`vite.config.ts` 全量替换为：

```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  test: {
    environment: "happy-dom",
    globals: true,
    setupFiles: "./src/test-setup.ts",
  },
});
```

新建 `src/test-setup.ts`：

```ts
import "@testing-library/jest-dom/vitest";
```

`src/styles.css` 全量替换为（Obsidian 风格深色底）：

```css
@import "tailwindcss";

:root {
  --bg: #1e1e1e;
  --bg-panel: #252526;
  --bg-editor: #1e1e1e;
  --fg: #d4d4d4;
  --fg-dim: #8a8a8a;
  --accent: #7c6ff0;
  --border: #3c3c3c;
}

html, body, #root { height: 100%; margin: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: "Microsoft YaHei UI", system-ui, sans-serif;
}
```

`package.json` scripts 增加：`"test": "vitest run --passWithNoTests"`

- [ ] **Step 5: 添加 Rust 依赖**

```bash
cd src-tauri
cargo add rusqlite --features bundled
cargo add rusqlite_migration
cargo add serde --features derive
cargo add serde_json
cargo add thiserror
cargo add tempfile --dev
```

- [ ] **Step 6: 验证工具链全绿**

```bash
pnpm build
pnpm test
cd src-tauri && cargo test
```

预期：三者成功（此时无测试用例，`cargo test` 输出 0 tests）。

- [ ] **Step 7: git init 与首次提交**

```bash
cd /d/Mycraft/Bixian
git init
git add -A
git commit -m "chore: 脚手架 Tauri2+React+TS+Tailwind4，配置测试栈与 Rust 依赖"
```

---

### Task 2: Rust 数据层——迁移、模型与 Book/Chapter 仓库

**Files:**
- Create: `src-tauri/src/error.rs`、`src-tauri/src/models.rs`、`src-tauri/src/db.rs`、`src-tauri/migrations/0001_init.sql`、`src-tauri/src/repo/mod.rs`、`src-tauri/src/repo/books.rs`、`src-tauri/src/repo/chapters.rs`、`src-tauri/tests/repo_test.rs`
- Modify: `src-tauri/src/lib.rs`（声明模块）

**Interfaces:**
- Produces（后续任务依赖的精确签名）:

```rust
// error.rs
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError { Db(String), Io(String), NotFound(String), Invalid(String), LockPoisoned }

// models.rs —— serde 序列化字段保持 snake_case（TS 接口同名对齐）
pub struct Book { pub id: i64, pub slug: String, pub title: String, pub created_at: String, pub updated_at: String }
pub struct ChapterMeta { pub id: i64, pub book_id: i64, pub file_path: String, pub title: String, pub sort_key: f64, pub word_count: i64, pub created_at: String, pub updated_at: String }
pub struct ChapterContent { pub meta: ChapterMeta, pub content: String }

// db.rs
pub fn init(conn: &Connection) -> Result<(), rusqlite_migration::Error>;

// repo/books.rs
pub fn list(conn: &Connection) -> Result<Vec<Book>, AppError>;
pub fn get(conn: &Connection, id: i64) -> Result<Book, AppError>;
pub fn get_by_slug(conn: &Connection, slug: &str) -> Result<Option<Book>, AppError>;
pub fn create(conn: &Connection, title: &str, slug: &str) -> Result<Book, AppError>;
pub fn delete(conn: &Connection, id: i64) -> Result<(), AppError>;

// repo/chapters.rs
pub fn list_by_book(conn: &Connection, book_id: i64) -> Result<Vec<ChapterMeta>, AppError>; // ORDER BY sort_key, id
pub fn get(conn: &Connection, id: i64) -> Result<ChapterMeta, AppError>;
pub fn create(conn: &Connection, book_id: i64, file_path: &str, title: &str) -> Result<ChapterMeta, AppError>;
pub fn rename(conn: &Connection, id: i64, new_title: &str, new_file_path: &str) -> Result<ChapterMeta, AppError>;
pub fn touch_content(conn: &Connection, id: i64, word_count: i64) -> Result<ChapterMeta, AppError>;
pub fn delete(conn: &Connection, id: i64) -> Result<(), AppError>;
pub fn next_index(conn: &Connection, book_id: i64) -> Result<i64, AppError>; // max(序号前缀)+1，供文件命名
```

- [ ] **Step 1: 写失败测试** `src-tauri/tests/repo_test.rs`

```rust
use bixian::db;
use bixian::repo;
use rusqlite::Connection;

fn test_conn() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    db::init(&conn).unwrap();
    conn
}

#[test]
fn create_book_and_chapters_ordered() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "红楼梦", "hongloumeng").unwrap();
    assert_eq!(book.title, "红楼梦");
    let c1 = repo::chapters::create(&conn, book.id, "hongloumeng/manuscript/0001-chu-jian.md", "初见").unwrap();
    let c2 = repo::chapters::create(&conn, book.id, "hongloumeng/manuscript/0002-feng-bo.md", "风波").unwrap();
    let list = repo::chapters::list_by_book(&conn, book.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, c1.id);
    assert_eq!(list[1].id, c2.id);
    assert!(list[0].sort_key < list[1].sort_key);
}

#[test]
fn next_index_increments_and_survives_delete() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    let c2 = repo::chapters::create(&conn, book.id, "shu/manuscript/0002-b.md", "二").unwrap();
    assert_eq!(repo::chapters::next_index(&conn, book.id).unwrap(), 3);
    repo::chapters::delete(&conn, c2.id).unwrap();
    assert_eq!(repo::chapters::next_index(&conn, book.id).unwrap(), 3); // 只增不减，避免重名
}

#[test]
fn delete_book_cascades_chapters() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    repo::books::delete(&conn, book.id).unwrap();
    assert!(repo::chapters::list_by_book(&conn, book.id).unwrap().is_empty());
    assert!(repo::books::get(&conn, book.id).is_err());
}

#[test]
fn rename_updates_title_and_path() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    let c = repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    let r = repo::chapters::rename(&conn, c.id, "新标题", "shu/manuscript/0001-xin-biao-ti.md").unwrap();
    assert_eq!(r.title, "新标题");
    assert_eq!(r.file_path, "shu/manuscript/0001-xin-biao-ti.md");
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test`
Expected: 编译失败 `unresolved import bixian::db`（模块不存在）

- [ ] **Step 3: 实现**

`src-tauri/migrations/0001_init.sql`（=规格书 §4.2 M0 DDL 原样）：

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
  file_path TEXT NOT NULL,
  title TEXT NOT NULL,
  sort_key REAL NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(book_id, file_path)
);
```

`src-tauri/src/error.rs`：

```rust
#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "code", content = "message", rename_all = "snake_case")]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(String),
    #[error("文件错误: {0}")]
    Io(String),
    #[error("未找到: {0}")]
    NotFound(String),
    #[error("非法参数: {0}")]
    Invalid(String),
    #[error("数据库锁中毒")]
    LockPoisoned,
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound("记录不存在".into()),
            _ => AppError::Db(e.to_string()),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self { AppError::Io(e.to_string()) }
}
pub type AppResult<T> = Result<T, AppError>;
```

`src-tauri/src/models.rs`：

```rust
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
```

`src-tauri/src/db.rs`：

```rust
use rusqlite::Connection;
use rusqlite_migration::{Migrations, M};

pub fn init(conn: &Connection) -> Result<(), rusqlite_migration::Error> {
    Migrations::new(vec![M::up(include_str!("../migrations/0001_init.sql"))])
        .to_latest(conn)
}
```

`src-tauri/src/repo/books.rs`：

```rust
use rusqlite::{params, Connection};
use crate::error::{AppError, AppResult};
use crate::models::Book;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<Book> {
    Ok(Book {
        id: row.get(0)?,
        slug: row.get(1)?,
        title: row.get(2)?,
        created_at: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

const COLS: &str = "id, slug, title, created_at, updated_at";

pub fn list(conn: &Connection) -> AppResult<Vec<Book>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLS} FROM books ORDER BY id"))?;
    let rows = stmt.query_map([], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<Book> {
    conn.query_row(&format!("SELECT {COLS} FROM books WHERE id = ?1"), [id], from_row)?
        .map_err(AppError::from)
}

pub fn get_by_slug(conn: &Connection, slug: &str) -> AppResult<Option<Book>> {
    match conn.query_row(&format!("SELECT {COLS} FROM books WHERE slug = ?1"), [slug], from_row) {
        Ok(b) => Ok(Some(b)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

pub fn create(conn: &Connection, title: &str, slug: &str) -> AppResult<Book> {
    conn.execute("INSERT INTO books (slug, title) VALUES (?1, ?2)", params![slug, title])?;
    get(conn, conn.last_insert_rowid())
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM books WHERE id = ?1", [id])?;
    Ok(())
}
```

`src-tauri/src/repo/chapters.rs`：

```rust
use rusqlite::{params, Connection};
use crate::error::{AppError, AppResult};
use crate::models::ChapterMeta;

fn from_row(row: &rusqlite::Row) -> rusqlite::Result<ChapterMeta> {
    Ok(ChapterMeta {
        id: row.get(0)?,
        book_id: row.get(1)?,
        file_path: row.get(2)?,
        title: row.get(3)?,
        sort_key: row.get(4)?,
        word_count: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

const COLS: &str = "id, book_id, file_path, title, sort_key, word_count, created_at, updated_at";

pub fn list_by_book(conn: &Connection, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLS} FROM chapters WHERE book_id = ?1 ORDER BY sort_key, id"))?;
    let rows = stmt.query_map([book_id], from_row)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

pub fn get(conn: &Connection, id: i64) -> AppResult<ChapterMeta> {
    conn.query_row(&format!("SELECT {COLS} FROM chapters WHERE id = ?1"), [id], from_row)?
        .map_err(AppError::from)
}

pub fn create(conn: &Connection, book_id: i64, file_path: &str, title: &str) -> AppResult<ChapterMeta> {
    let sort_key = conn.query_row(
        "SELECT COALESCE(MAX(sort_key), 0.0) + 1.0 FROM chapters WHERE book_id = ?1",
        [book_id], |r| r.get::<_, f64>(0))?;
    conn.execute(
        "INSERT INTO chapters (book_id, file_path, title, sort_key) VALUES (?1, ?2, ?3, ?4)",
        params![book_id, file_path, title, sort_key])?;
    get(conn, conn.last_insert_rowid())
}

pub fn rename(conn: &Connection, id: i64, new_title: &str, new_file_path: &str) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET title = ?2, file_path = ?3, updated_at = datetime('now') WHERE id = ?1",
        params![id, new_title, new_file_path])?;
    get(conn, id)
}

pub fn touch_content(conn: &Connection, id: i64, word_count: i64) -> AppResult<ChapterMeta> {
    conn.execute(
        "UPDATE chapters SET word_count = ?2, updated_at = datetime('now') WHERE id = ?1",
        params![id, word_count])?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    conn.execute("DELETE FROM chapters WHERE id = ?1", [id])?;
    Ok(())
}

/// 下一个文件名序号：取 max(文件名 4 位前缀) + 1；无记录时 1。只增不减。
pub fn next_index(conn: &Connection, book_id: i64) -> AppResult<i64> {
    let paths: Vec<String> = {
        let mut stmt = conn.prepare("SELECT file_path FROM chapters WHERE book_id = ?1")?;
        let rows = stmt.query_map([book_id], |r| r.get::<_, String>(0))?;
        rows.collect::<Result<Vec<_>, _>>()?
    };
    let max = paths.iter().filter_map(|p| {
        p.rsplit('/').next()?.split('-').next()?.parse::<i64>().ok()
    }).max().unwrap_or(0);
    Ok(max + 1)
}
```

`src-tauri/src/repo/mod.rs`：

```rust
pub mod books;
pub mod chapters;
```

`src-tauri/src/lib.rs` 在已有 `run()` 之外顶部加：

```rust
pub mod db;
pub mod error;
pub mod models;
pub mod repo;
```

注意：外键级联需开启——`db.rs` 的 `init` 末尾追加：

```rust
conn.pragma_update(None, "foreign_keys", "ON")?;
```

（返回类型改 `Result<(), Box<dyn std::error::Error>>` 或在调用处处理 rusqlite 错误，实现时保持简单）

- [ ] **Step 4: 运行测试通过**

Run: `cd src-tauri && cargo test`
Expected: 4 个测试 PASS

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: 数据层——迁移、错误类型、Book/Chapter 仓库与测试"
```

---

### Task 3: 文件服务 fs_service 与中文词数统计

**Files:**
- Create: `src-tauri/src/fs_service.rs`、`src-tauri/src/util.rs`、`src-tauri/tests/fs_test.rs`
- Modify: `src-tauri/src/lib.rs`（加 `pub mod fs_service; pub mod util;`）

**Interfaces:**
- Consumes: Task 2 的 `AppError`
- Produces:

```rust
// fs_service.rs
pub fn library_root(app_data: &std::path::Path) -> std::path::PathBuf; // app_data.join("library")
pub fn slugify(input: &str) -> String;      // 保留 [A-Za-z0-9] 与 CJK，其余→'-'，折叠去首尾，空→"untitled"
pub fn unique_slug(root: &std::path::Path, base: &str) -> String;      // 冲突追加 -2/-3
pub fn create_book_dir(root: &std::path::Path, slug: &str, title: &str) -> Result<(), AppError>; // manuscript/ + book.json
pub fn chapter_rel_path(slug: &str, index: i64, title: &str) -> String; // "{slug}/manuscript/{:04}-{slugify(title)}.md"
pub fn write_chapter(root: &std::path::Path, rel: &str, content: &str) -> Result<(), AppError>;
pub fn read_chapter(root: &std::path::Path, rel: &str) -> Result<String, AppError>;
pub fn delete_rel(root: &std::path::Path, rel: &str) -> Result<(), AppError>;
pub struct ScannedBook { pub slug: String, pub title: String, pub files: Vec<String> } // files 为相对路径
pub fn scan_library(root: &std::path::Path) -> Result<Vec<ScannedBook>, AppError>;

// util.rs
pub fn count_words(text: &str) -> i64; // CJK 逐字计 1；连续 ASCII 字母数字计 1
pub fn is_cjk(c: char) -> bool;
```

- [ ] **Step 1: 写失败测试** `src-tauri/tests/fs_test.rs`

```rust
use bixian::fs_service as fsx;
use bixian::util::count_words;

#[test]
fn count_words_cjk_and_latin() {
    assert_eq!(count_words("黛玉走进来，说：“好。”"), 7); // 黛玉走进来说好
    assert_eq!(count_words("hello world 123"), 3);
    assert_eq!(count_words("第3章 AI来了"), 5); // 第章来了=4 CJK + "3"+"AI"=2 → 6？见下
}

#[test]
fn slugify_rules() {
    assert_eq!(fsx::slugify("红楼梦"), "红楼梦");
    assert_eq!(fsx::slugify("My Book: Vol.1"), "my-book-vol-1");
    assert_eq!(fsx::slugify("///"), "untitled");
}

#[test]
fn chapter_path_format() {
    assert_eq!(fsx::chapter_rel_path("shu", 12, "初见"), "shu/manuscript/0012-初见.md");
}

#[test]
fn book_dir_and_roundtrip_and_scan() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    fsx::create_book_dir(&root, "hongloumeng", "红楼梦").unwrap();
    let rel = fsx::chapter_rel_path("hongloumeng", 1, "初见");
    fsx::write_chapter(&root, &rel, "黛玉进了贾府。").unwrap();
    assert_eq!(fsx::read_chapter(&root, &rel).unwrap(), "黛玉进了贾府。");
    let scanned = fsx::scan_library(&root).unwrap();
    assert_eq!(scanned.len(), 1);
    assert_eq!(scanned[0].title, "红楼梦");
    assert_eq!(scanned[0].files, vec![rel]);
    fsx::delete_rel(&root, &rel).unwrap();
    assert!(fsx::scan_library(&root).unwrap()[0].files.is_empty());
}

#[test]
fn unique_slug_appends_suffix() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    assert_eq!(fsx::unique_slug(&root, "书"), "书");
    std::fs::create_dir_all(root.join("书")).unwrap();
    assert_eq!(fsx::unique_slug(&root, "书"), "书-2");
}
```

注：`count_words("第3章 AI来了")` 的期望值——先在实现中确定规则（第/章/来/了=4 个 CJK，"3"=1 词，"AI"=1 词 → 6），把测试断言写成 `assert_eq!(count_words("第3章 AI来了"), 6);`（以 6 为准）。

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test`
Expected: 编译失败 `unresolved import bixian::fs_service`

- [ ] **Step 3: 实现**

`src-tauri/src/util.rs`：

```rust
pub fn is_cjk(c: char) -> bool {
    matches!(c as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF | 0x20000..=0x2A6DF)
}

pub fn count_words(text: &str) -> i64 {
    let (mut cjk, mut latin, mut in_word) = (0i64, 0i64, false);
    for ch in text.chars() {
        if is_cjk(ch) { cjk += 1; in_word = false; }
        else if ch.is_ascii_alphanumeric() {
            if !in_word { latin += 1; in_word = true; }
        } else { in_word = false; }
    }
    cjk + latin
}
```

`src-tauri/src/fs_service.rs`：

```rust
use std::fs;
use std::path::{Path, PathBuf};
use crate::error::{AppError, AppResult};
use crate::util::is_cjk;

pub fn library_root(app_data: &Path) -> PathBuf { app_data.join("library") }

pub fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = true; // 折叠连续分隔符并去头部
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() || is_cjk(ch) {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let s = out.trim_end_matches('-').to_string();
    if s.is_empty() { "untitled".into() } else { s }
}

pub fn unique_slug(root: &Path, base: &str) -> String {
    if !root.join(base).exists() { return base.to_string(); }
    for n in 2.. { let cand = format!("{base}-{n}"); if !root.join(&cand).exists() { return cand; } }
    unreachable!()
}

pub fn create_book_dir(root: &Path, slug: &str, title: &str) -> AppResult<()> {
    let dir = root.join(slug);
    fs::create_dir_all(dir.join("manuscript"))?;
    fs::write(dir.join("book.json"), serde_json::json!({ "title": title }).to_string())?;
    Ok(())
}

pub fn chapter_rel_path(slug: &str, index: i64, title: &str) -> String {
    format!("{slug}/manuscript/{:04}-{}.md", index, slugify(title))
}

fn abs(root: &Path, rel: &str) -> AppResult<PathBuf> {
    let p = root.join(rel);
    if !p.starts_with(root) { return Err(AppError::Invalid("路径越界".into())); }
    Ok(p)
}

pub fn write_chapter(root: &Path, rel: &str, content: &str) -> AppResult<()> {
    let p = abs(root, rel)?;
    if let Some(parent) = p.parent() { fs::create_dir_all(parent)?; }
    fs::write(p, content)?;
    Ok(())
}

pub fn read_chapter(root: &Path, rel: &str) -> AppResult<String> {
    Ok(fs::read_to_string(abs(root, rel)?)?)
}

pub fn delete_rel(root: &Path, rel: &str) -> AppResult<()> {
    let p = abs(root, rel)?;
    if p.is_dir() { fs::remove_dir_all(p)?; } else { fs::remove_file(p)?; }
    Ok(())
}

pub struct ScannedBook { pub slug: String, pub title: String, pub files: Vec<String> }

pub fn scan_library(root: &Path) -> AppResult<Vec<ScannedBook>> {
    let mut out = Vec::new();
    let entries = match fs::read_dir(root) { Ok(e) => e, Err(_) => return Ok(out) };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() { continue; }
        let slug = entry.file_name().to_string_lossy().to_string();
        let title = fs::read_to_string(dir.join("book.json")).ok()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
            .and_then(|v| v["title"].as_str().map(String::from))
            .unwrap_or_else(|| slug.clone());
        let mut files = Vec::new();
        if let Ok(rd) = fs::read_dir(dir.join("manuscript")) {
            for f in rd.flatten() {
                if f.path().extension().map(|e| e == "md").unwrap_or(false) {
                    let name = f.file_name().to_string_lossy().to_string();
                    files.push(format!("{slug}/manuscript/{name}"));
                }
            }
        }
        files.sort();
        out.push(ScannedBook { slug, title, files });
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    Ok(out)
}
```

`src-tauri/src/lib.rs` 加：`pub mod fs_service; pub mod util;`

- [ ] **Step 4: 运行测试通过**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS（含 Task 2 的 4 个）

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: 文件服务与中文词数统计（slugify/读写/扫描/防路径越界）"
```

---

### Task 4: AppState 与 Tauri 命令层

**Files:**
- Create: `src-tauri/src/state.rs`、`src-tauri/src/commands.rs`、`src-tauri/tests/commands_test.rs`
- Modify: `src-tauri/src/lib.rs`（模块声明 + setup 管理状态 + 注册命令）

**Interfaces:**
- Consumes: Task 2 repo、Task 3 fs_service
- Produces:

```rust
// state.rs
pub struct AppState { pub db: std::sync::Mutex<rusqlite::Connection>, pub root: std::path::PathBuf }
impl AppState {
    pub fn init(app_data: &std::path::Path) -> Result<Self, AppError>; // 建目录、开库、迁移、library/
    pub fn test_state(app_data: &std::path::Path) -> Self;             // 测试用：独立 db 文件于该目录
}
// commands.rs —— 每个 *_inner 可独立测试；#[tauri::command] 包装同名去 _inner
list_books / create_book(title) / delete_book(id)
list_chapters(book_id) / create_chapter(book_id, title) / rename_chapter(id, new_title)
delete_chapter(id) / read_chapter(id) -> ChapterContent / write_chapter(id, content) -> ChapterMeta
// 前端可 invoke 的命令名 = 去掉 _inner 的名字
```

- [ ] **Step 1: 写失败测试** `src-tauri/tests/commands_test.rs`

```rust
use bixian::commands as cmd;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

#[test]
fn book_chapter_full_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "红楼梦").unwrap();
    assert_eq!(book.slug, "红楼梦");
    let ch = cmd::create_chapter_inner(&s, book.id, "初见").unwrap();
    assert!(ch.file_path.ends_with("0001-初见.md"));
    let meta = cmd::write_chapter_inner(&s, ch.id, "黛玉进了贾府，见了宝玉。").unwrap();
    assert_eq!(meta.word_count, 12); // 黛玉进了贾府见了宝玉 = 10 + 逗号句号不计 → 10？以实现规则核对
    let back = cmd::read_chapter_inner(&s, ch.id).unwrap();
    assert_eq!(back.content, "黛玉进了贾府，见了宝玉。");
    assert_eq!(back.meta.id, ch.id);
}

#[test]
fn rename_moves_file() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一章").unwrap();
    let old_abs = s.root.join(&ch.file_path);
    assert!(old_abs.exists());
    let renamed = cmd::rename_chapter_inner(&s, ch.id, "新章").unwrap();
    assert!(!old_abs.exists());
    assert!(s.root.join(&renamed.file_path).exists());
    let _ = tmp; // 持有到函数结束
}

#[test]
fn delete_removes_file_and_row() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();
    assert!(!s.root.join(&ch.file_path).exists());
    assert!(cmd::list_chapters_inner(&s, book.id).unwrap().is_empty());
}

#[test]
fn invalid_title_rejected() {
    let (_tmp, s) = setup();
    assert!(cmd::create_book_inner(&s, "").is_err());
}
```

注：`word_count` 断言先手工按规则数（黛玉进了贾府见了宝玉 = 10 个 CJK 字），写成 `assert_eq!(meta.word_count, 10);`。

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test`
Expected: 编译失败 `unresolved import bixian::commands`

- [ ] **Step 3: 实现**

`src-tauri/src/state.rs`：

```rust
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use rusqlite::Connection;
use crate::db;
use crate::error::AppError;
use crate::fs_service;

pub struct AppState {
    pub db: Mutex<Connection>,
    pub root: PathBuf,
}

impl AppState {
    pub fn init(app_data: &Path) -> Result<Self, AppError> {
        fs::create_dir_all(app_data)?;
        let conn = Connection::open(app_data.join("bixian.db"))?;
        db::init(&conn).map_err(|e| AppError::Db(e.to_string()))?;
        let root = fs_service::library_root(app_data);
        fs::create_dir_all(&root)?;
        Ok(Self { db: Mutex::new(conn), root })
    }

    /// 测试用：目录内独立 db 文件，不与开发者本机数据混用
    pub fn test_state(app_data: &Path) -> Self {
        Self::init(app_data).expect("测试状态初始化失败")
    }
}
```

`src-tauri/src/commands.rs`：

```rust
use tauri::State;
use crate::error::{AppError, AppResult};
use crate::fs_service;
use crate::models::{Book, ChapterContent, ChapterMeta};
use crate::repo;
use crate::state::AppState;
use crate::util::count_words;

fn lock(s: &AppState) -> AppResult<std::sync::MutexGuard<'_, rusqlite::Connection>> {
    s.db.lock().map_err(|_| AppError::LockPoisoned)
}

pub fn list_books_inner(s: &AppState) -> AppResult<Vec<Book>> {
    repo::books::list(&lock(s)?)
}

pub fn create_book_inner(s: &AppState, title: &str) -> AppResult<Book> {
    let title = title.trim();
    if title.is_empty() { return Err(AppError::Invalid("书名不能为空".into())); }
    let slug = {
        let conn = lock(s)?;
        fs_service::unique_slug(&s.root, &fs_service::slugify(title))
    };
    fs_service::create_book_dir(&s.root, &slug, title)?;
    let book = lock(s).and_then(|conn| repo::books::create(&*conn, title, &slug))?;
    Ok(book)
}

pub fn delete_book_inner(s: &AppState, id: i64) -> AppResult<()> {
    let book = lock(s).and_then(|conn| repo::books::get(&*conn, id))?;
    fs_service::delete_rel(&s.root, &book.slug)?;
    lock(s).and_then(|conn| repo::books::delete(&*conn, id))
}

pub fn list_chapters_inner(s: &AppState, book_id: i64) -> AppResult<Vec<ChapterMeta>> {
    repo::chapters::list_by_book(&lock(s)?, book_id)
}

pub fn create_chapter_inner(s: &AppState, book_id: i64, title: &str) -> AppResult<ChapterMeta> {
    let title = title.trim();
    if title.is_empty() { return Err(AppError::Invalid("章节标题不能为空".into())); }
    let (slug, index) = {
        let conn = lock(s)?;
        let book = repo::books::get(&*conn, book_id)?;
        (book.slug, repo::chapters::next_index(&*conn, book_id)?)
    };
    let rel = fs_service::chapter_rel_path(&slug, index, title);
    fs_service::write_chapter(&s.root, &rel, "")?;
    lock(s).and_then(|conn| repo::chapters::create(&*conn, book_id, &rel, title))
}

pub fn rename_chapter_inner(s: &AppState, id: i64, new_title: &str) -> AppResult<ChapterMeta> {
    let new_title = new_title.trim();
    if new_title.is_empty() { return Err(AppError::Invalid("章节标题不能为空".into())); }
    let (old_rel, new_rel) = {
        let conn = lock(s)?;
        let ch = repo::chapters::get(&*conn, id)?;
        let book = repo::books::get(&*conn, ch.book_id)?;
        let index = ch.file_path.rsplit('/').next().unwrap()
            .split('-').next().unwrap().parse::<i64>().unwrap_or(1);
        (ch.file_path.clone(), fs_service::chapter_rel_path(&book.slug, index, new_title))
    };
    let old_abs = s.root.join(&old_rel);
    let new_abs = s.root.join(&new_rel);
    if old_abs != new_abs && new_abs.exists() {
        return Err(AppError::Invalid("目标文件名已存在".into()));
    }
    if let Some(p) = old_abs.parent() { std::fs::create_dir_all(p)?; }
    std::fs::rename(&old_abs, &new_abs)?;
    lock(s).and_then(|conn| repo::chapters::rename(&*conn, id, new_title, &new_rel))
}

pub fn delete_chapter_inner(s: &AppState, id: i64) -> AppResult<()> {
    let rel = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?.file_path;
    fs_service::delete_rel(&s.root, &rel)?;
    lock(s).and_then(|conn| repo::chapters::delete(&*conn, id))
}

pub fn read_chapter_inner(s: &AppState, id: i64) -> AppResult<ChapterContent> {
    let (meta,) = {
        let conn = lock(s)?;
        (repo::chapters::get(&*conn, id)?,)
    };
    let content = fs_service::read_chapter(&s.root, &meta.file_path)?;
    Ok(ChapterContent { meta, content })
}

pub fn write_chapter_inner(s: &AppState, id: i64, content: &str) -> AppResult<ChapterMeta> {
    let rel = lock(s).and_then(|conn| repo::chapters::get(&*conn, id))?.file_path;
    fs_service::write_chapter(&s.root, &rel, content)?;
    let wc = count_words(content);
    lock(s).and_then(|conn| repo::chapters::touch_content(&*conn, id, wc))
}

// ---- Tauri 薄包装 ----
#[tauri::command] pub fn list_books(s: State<AppState>) -> AppResult<Vec<Book>> { list_books_inner(&s) }
#[tauri::command] pub fn create_book(s: State<AppState>, title: String) -> AppResult<Book> { create_book_inner(&s, &title) }
#[tauri::command] pub fn delete_book(s: State<AppState>, id: i64) -> AppResult<()> { delete_book_inner(&s, id) }
#[tauri::command] pub fn list_chapters(s: State<AppState>, book_id: i64) -> AppResult<Vec<ChapterMeta>> { list_chapters_inner(&s, book_id) }
#[tauri::command] pub fn create_chapter(s: State<AppState>, book_id: i64, title: String) -> AppResult<ChapterMeta> { create_chapter_inner(&s, book_id, &title) }
#[tauri::command] pub fn rename_chapter(s: State<AppState>, id: i64, new_title: String) -> AppResult<ChapterMeta> { rename_chapter_inner(&s, id, &new_title) }
#[tauri::command] pub fn delete_chapter(s: State<AppState>, id: i64) -> AppResult<()> { delete_chapter_inner(&s, id) }
#[tauri::command] pub fn read_chapter(s: State<AppState>, id: i64) -> AppResult<ChapterContent> { read_chapter_inner(&s, id) }
#[tauri::command] pub fn write_chapter(s: State<AppState>, id: i64, content: String) -> AppResult<ChapterMeta> { write_chapter_inner(&s, id, &content) }
```

`src-tauri/src/lib.rs` 的 `run()` 改为（保留模板默认 builder 内容，新增 setup 与命令注册）：

```rust
pub mod commands;
pub mod fs_service; // 若 Task 3 已加则不重复
pub mod state;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(state::AppState::init(&dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_books, commands::create_book, commands::delete_book,
            commands::list_chapters, commands::create_chapter, commands::rename_chapter,
            commands::delete_chapter, commands::read_chapter, commands::write_chapter,
        ])
        .run(tauri::generate_context!())
        .expect("error while running bixian");
}
```

（模板 run() 中原有的 `.run()` 调用替换为上述；setup 闭包返回类型按编译器提示用 `Box<dyn std::error::Error>` 兼容。）

- [ ] **Step 4: 运行测试通过**

Run: `cd src-tauri && cargo test`
Expected: 全部 PASS（累计 13 个左右）

- [ ] **Step 5: Commit**

```bash
git add src-tauri
git commit -m "feat: AppState 与 Tauri 命令层（书籍/章节全套 CRUD 内核可测）"
```

---

### Task 5: 前端三栏布局骨架、状态与 Tauri 封装

**Files:**
- Create: `src/lib/tauri.ts`、`src/stores/workspace.ts`、`src/components/layout/AppShell.tsx`、`src/components/layout/Sidebar.tsx`、`src/components/layout/PanelDock.tsx`、`src/components/editor/EditorPane.tsx`（占位）、`src/lib/words.ts`、`src/stores/workspace.test.ts`、`src/components/layout/Sidebar.test.tsx`
- Modify: `src/App.tsx`、`src/main.tsx`（如模板有冗余示例文件一并清理）

**Interfaces:**
- Consumes: Task 4 命令（命令名与字段 snake_case 对齐）
- Produces（Task 6 依赖）:

```ts
// lib/tauri.ts
export interface Book { id: number; slug: string; title: string; created_at: string; updated_at: string }
export interface ChapterMeta { id: number; book_id: number; file_path: string; title: string; sort_key: number; word_count: number; created_at: string; updated_at: string }
export interface ChapterContent { meta: ChapterMeta; content: string }
export const api: {
  listBooks(): Promise<Book[]>; createBook(title: string): Promise<Book>; deleteBook(id: number): Promise<void>;
  listChapters(bookId: number): Promise<ChapterMeta[]>; createChapter(bookId: number, title: string): Promise<ChapterMeta>;
  renameChapter(id: number, newTitle: string): Promise<ChapterMeta>; deleteChapter(id: number): Promise<void>;
  readChapter(id: number): Promise<ChapterContent>; writeChapter(id: number, content: string): Promise<ChapterMeta>;
}
// stores/workspace.ts
interface WorkspaceState {
  books: Book[]; chapters: ChapterMeta[]; currentBookId: number | null; currentChapterId: number | null;
  loading: boolean; error: string | null;
  loadBooks(): Promise<void>; selectBook(id: number): Promise<void>;
  createBook(title: string): Promise<void>; createChapter(title: string): Promise<void>;
  selectChapter(id: number): void;
}
// lib/words.ts
export function countWords(text: string): number; // 与 Rust util::count_words 同规则
```

- [ ] **Step 1: 写失败测试** `src/stores/workspace.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const books = [{ id: 1, slug: "shu", title: "书", created_at: "", updated_at: "" }];
  const chapters = [
    { id: 11, book_id: 1, file_path: "shu/manuscript/0001-yi.md", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "" },
  ];
  return {
    api: {
      listBooks: vi.fn().mockResolvedValue(books),
      createBook: vi.fn().mockResolvedValue(books[0]),
      listChapters: vi.fn().mockResolvedValue(chapters),
      createChapter: vi.fn().mockResolvedValue(chapters[0]),
    },
  };
});

import { useWorkspace } from "./workspace";

describe("workspace store", () => {
  beforeEach(() => useWorkspace.setState({ books: [], chapters: [], currentBookId: null, currentChapterId: null }));

  it("loadBooks 填充书籍", async () => {
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().books).toHaveLength(1);
  });

  it("selectBook 加载章节并记住当前书", async () => {
    await useWorkspace.getState().selectBook(1);
    expect(useWorkspace.getState().currentBookId).toBe(1);
    expect(useWorkspace.getState().chapters).toHaveLength(1);
  });

  it("createChapter 后刷新章节列表", async () => {
    await useWorkspace.getState().selectBook(1);
    await useWorkspace.getState().createChapter("二");
    expect(useWorkspace.getState().chapters).toHaveLength(1); // mock 返回同列表
  });
});
```

`src/components/layout/Sidebar.test.tsx`：

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Sidebar } from "./Sidebar";
import { useWorkspace } from "../../stores/workspace";

describe("Sidebar", () => {
  it("显示书籍与章节", () => {
    useWorkspace.setState({
      books: [{ id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "" }],
      chapters: [{ id: 11, book_id: 1, file_path: "", title: "初见", sort_key: 1, word_count: 0, created_at: "", updated_at: "" }],
      currentBookId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("红楼梦")).toBeInTheDocument();
    expect(screen.getByText("初见")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

`src/lib/tauri.ts`：

```ts
import { invoke } from "@tauri-apps/api/core";

export interface Book { id: number; slug: string; title: string; created_at: string; updated_at: string }
export interface ChapterMeta { id: number; book_id: number; file_path: string; title: string; sort_key: number; word_count: number; created_at: string; updated_at: string }
export interface ChapterContent { meta: ChapterMeta; content: string }

export const api = {
  listBooks: () => invoke<Book[]>("list_books"),
  createBook: (title: string) => invoke<Book>("create_book", { title }),
  deleteBook: (id: number) => invoke<void>("delete_book", { id }),
  listChapters: (bookId: number) => invoke<ChapterMeta[]>("list_chapters", { bookId }),
  createChapter: (bookId: number, title: string) => invoke<ChapterMeta>("create_chapter", { bookId, title }),
  renameChapter: (id: number, newTitle: string) => invoke<ChapterMeta>("rename_chapter", { id, newTitle }),
  deleteChapter: (id: number) => invoke<void>("delete_chapter", { id }),
  readChapter: (id: number) => invoke<ChapterContent>("read_chapter", { id }),
  writeChapter: (id: number, content: string) => invoke<ChapterMeta>("write_chapter", { id, content }),
};
```

`src/stores/workspace.ts`：

```ts
import { create } from "zustand";
import { api, Book, ChapterMeta } from "../lib/tauri";

interface WorkspaceState {
  books: Book[]; chapters: ChapterMeta[];
  currentBookId: number | null; currentChapterId: number | null;
  loading: boolean; error: string | null;
  loadBooks: () => Promise<void>;
  selectBook: (id: number) => Promise<void>;
  createBook: (title: string) => Promise<void>;
  createChapter: (title: string) => Promise<void>;
  selectChapter: (id: number) => void;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  books: [], chapters: [], currentBookId: null, currentChapterId: null, loading: false, error: null,
  loadBooks: async () => {
    set({ loading: true, error: null });
    try { set({ books: await api.listBooks(), loading: false }); }
    catch (e) { set({ error: String(e), loading: false }); }
  },
  selectBook: async (id) => {
    set({ currentBookId: id, currentChapterId: null });
    set({ chapters: await api.listChapters(id) });
  },
  createBook: async (title) => {
    const book = await api.createBook(title);
    await get().loadBooks();
    await get().selectBook(book.id);
  },
  createChapter: async (title) => {
    const bookId = get().currentBookId;
    if (bookId == null) return;
    await api.createChapter(bookId, title);
    set({ chapters: await api.listChapters(bookId) });
  },
  selectChapter: (id) => set({ currentChapterId: id }),
}));
```

`src/lib/words.ts`：

```ts
export function isCjk(code: number): boolean {
  return (code >= 0x4e00 && code <= 0x9fff) || (code >= 0x3400 && code <= 0x4dbf)
    || (code >= 0xf900 && code <= 0xfaff) || (code >= 0x20000 && code <= 0x2a6df);
}

export function countWords(text: string): number {
  let cjk = 0, latin = 0, inWord = false;
  for (const ch of text) {
    if (isCjk(ch.codePointAt(0)!)) { cjk++; inWord = false; }
    else if (/[a-z0-9]/i.test(ch)) { if (!inWord) { latin++; inWord = true; } }
    else { inWord = false; }
  }
  return cjk + latin;
}
```

`src/components/layout/AppShell.tsx`：

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "../editor/EditorPane";
import { PanelDock } from "./PanelDock";

export function AppShell() {
  return (
    <PanelGroup direction="horizontal" className="h-full">
      <Panel defaultSize={18} minSize={12} maxSize={30} className="border-r" style={{ borderRightColor: "var(--border)" }}>
        <Sidebar />
      </Panel>
      <PanelResizeHandle className="w-1 bg-transparent hover:bg-[var(--accent)] transition-colors" />
      <Panel minSize={30}>
        <EditorPane />
      </Panel>
      <PanelResizeHandle className="w-1 bg-transparent hover:bg-[var(--accent)] transition-colors" />
      <Panel defaultSize={24} minSize={16} maxSize={40} className="border-l" style={{ borderLeftColor: "var(--border)" }}>
        <PanelDock />
      </Panel>
    </PanelGroup>
  );
}
```

`src/components/layout/Sidebar.tsx`：

```tsx
import { useEffect, useState } from "react";
import { useWorkspace } from "../../stores/workspace";

export function Sidebar() {
  const { books, chapters, currentBookId, currentChapterId, loadBooks, selectBook, createBook, createChapter, selectChapter } = useWorkspace();
  const [newBook, setNewBook] = useState("");
  const [newChapter, setNewChapter] = useState("");

  useEffect(() => { loadBooks(); }, [loadBooks]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)] text-sm">
      <div className="border-b p-2" style={{ borderColor: "var(--border)" }}>
        <div className="mb-1 font-medium text-[var(--fg-dim)]">书籍</div>
        {books.map((b) => (
          <div key={b.id}
            onClick={() => selectBook(b.id)}
            className={`cursor-pointer rounded px-2 py-1 ${currentBookId === b.id ? "bg-[var(--accent)]/20 text-white" : "hover:bg-white/5"}`}>
            {b.title}
          </div>
        ))}
        <div className="mt-1 flex gap-1">
          <input value={newBook} onChange={(e) => setNewBook(e.target.value)} placeholder="新书名…"
            className="w-full rounded border bg-transparent px-1 py-0.5" style={{ borderColor: "var(--border)" }} />
          <button onClick={async () => { if (newBook.trim()) { await createBook(newBook.trim()); setNewBook(""); } }}
            className="rounded px-2 py-0.5" style={{ background: "var(--accent)" }}>＋</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 font-medium text-[var(--fg-dim)]">章节</div>
        {chapters.map((c) => (
          <div key={c.id}
            onClick={() => selectChapter(c.id)}
            className={`cursor-pointer rounded px-2 py-1 ${currentChapterId === c.id ? "bg-[var(--accent)]/20 text-white" : "hover:bg-white/5"}`}>
            {c.title}
          </div>
        ))}
        {currentBookId != null && (
          <div className="mt-1 flex gap-1">
            <input value={newChapter} onChange={(e) => setNewChapter(e.target.value)} placeholder="新章节…"
              className="w-full rounded border bg-transparent px-1 py-0.5" style={{ borderColor: "var(--border)" }} />
            <button onClick={async () => { if (newChapter.trim()) { await createChapter(newChapter.trim()); setNewChapter(""); } }}
              className="rounded px-2 py-0.5" style={{ background: "var(--accent)" }}>＋</button>
          </div>
        )}
      </div>
    </div>
  );
}
```

`src/components/layout/PanelDock.tsx`：

```tsx
import { useState } from "react";

const TABS = ["大纲", "人物", "伏笔", "碰碰车"] as const;

export function PanelDock() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("大纲");
  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)]">
      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1.5 text-sm ${tab === t ? "border-b-2 text-white" : "text-[var(--fg-dim)]"}`}
            style={tab === t ? { borderColor: "var(--accent)" } : undefined}>{t}</button>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center text-[var(--fg-dim)]">
        「{tab}」面板将在后续里程碑提供
      </div>
    </div>
  );
}
```

`src/components/editor/EditorPane.tsx`（M0 Task 5 占位，Task 6 替换）：

```tsx
export function EditorPane() {
  return <div className="flex h-full items-center justify-center text-[var(--fg-dim)]">选择或创建一个章节开始写作</div>;
}
```

`src/App.tsx` 全量替换：

```tsx
import { AppShell } from "./components/layout/AppShell";

export default function App() {
  return <AppShell />;
}
```

（删除模板的 App.css 引用与示例组件；`src/main.tsx` 保持模板，确认引入 `./styles.css`。）

- [ ] **Step 4: 运行测试与构建**

Run: `pnpm test && pnpm build`
Expected: 测试 PASS；构建成功

- [ ] **Step 5: 手动冒烟**

Run: `pnpm tauri dev`（首次编译 Rust 约 2-5 分钟）
预期：窗口标题「笔仙」；三栏可见可拖宽；新建书《测试书》→ 建章「第一章」→ 侧栏正确显示；右面板四个占位标签可切换。验证 `%APPDATA%/com.bixian.app/library/测试书/manuscript/0001-第一章.md` 存在。关闭窗口。

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: 三栏布局骨架、Zustand 工作区状态、Tauri 命令封装"
```

---

### Task 6: TipTap 编辑器——Markdown 双向与自动保存

**Files:**
- Create: `src/components/editor/ChapterEditor.tsx`、`src/hooks/useAutosave.ts`、`src/hooks/useAutosave.test.ts`、`src/components/editor/markdown.test.ts`
- Modify: `src/components/editor/EditorPane.tsx`（接入真编辑器）、`src/stores/workspace.ts`（增加 chapterContent 状态）

**Interfaces:**
- Consumes: Task 5 的 `api.readChapter/writeChapter`、`useWorkspace`
- Produces: `useAutosave(getDirty, save, delayMs)` 通用钩子（返回 `{ status: "idle" | "saving" | "saved" }`）；编辑器组件 `ChapterEditor`（Task 7+ 的伏笔 mark、实体 mark 将挂在其 TipTap 扩展上）

- [ ] **Step 1: 安装锁定版本的编辑器依赖**

```bash
pnpm add @tiptap/core@^2.26.0 @tiptap/pm@^2.26.0 @tiptap/starter-kit@^2.26.0 tiptap-markdown
```

- [ ] **Step 2: 写失败测试** `src/hooks/useAutosave.test.ts`

```ts
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("内容变化 800ms 后触发保存一次", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(() => "内容v1", save, 800));
    expect(result.current.status).toBe("idle");
    act(() => { vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("连续变化只保存最后一次内容", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let text = "a";
    const { result } = renderHook(() => useAutosave(() => text, save, 800));
    act(() => { text = "b"; vi.advanceTimersByTime(500); });
    act(() => { text = "c"; vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c");
  });
});
```

`src/components/editor/markdown.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

function editorWith(md: string) {
  return new Editor({
    extensions: [StarterKit, Markdown],
    content: md,
  });
}

describe("markdown 双向转换", () => {
  it("标题/段落/加粗经加载再导出保持不变", () => {
    const md = "# 第一章 初见\n\n黛玉走进来，看了宝玉一眼。\n\n**她心里想：这人似曾相识。**";
    const editor = editorWith(md);
    const out = editor.storage.markdown.getMarkdown();
    expect(out).toContain("# 第一章 初见");
    expect(out).toContain("黛玉走进来，看了宝玉一眼。");
    expect(out.replace(/\s+/g, "")).toContain("**她心里想：这人似曾相识。**".replace(/\s+/g, ""));
  });

  it("空内容往返为空", () => {
    const editor = editorWith("");
    expect(editor.storage.markdown.getMarkdown().trim()).toBe("");
  });
});
```

- [ ] **Step 3: 运行确认失败**

Run: `pnpm test`
Expected: FAIL（模块不存在）

- [ ] **Step 4: 实现**

`src/hooks/useAutosave.ts`：

```ts
import { useEffect, useRef, useState } from "react";

export function useAutosave(getDirty: () => string | null, save: (content: string) => Promise<void>, delayMs = 800) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(null);

  useEffect(() => {
    const content = getDirty();
    if (content == null || content === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setStatus("saving");
      await save(content);
      lastSaved.current = content;
      setStatus("saved");
    }, delayMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  });

  return { status };
}
```

（说明：effect 无依赖数组，每次渲染都检查——依赖 `getDirty` 返回内容比较，模板组件 onUpdate 后触发重渲染即可驱动。）

`src/stores/workspace.ts` 增补（在接口与实现中各加）：

```ts
chapterContent: string | null;
selectChapter: (id: number) => void; // 改为 async：读内容
// 实现中：
selectChapter: async (id) => {
  set({ currentChapterId: id });
  const full = await api.readChapter(id);
  set({ chapterContent: full.content });
},
```

（原 `selectChapter: (id) => set(...)` 替换；初始 state 加 `chapterContent: null`。测试同步相应调整——mock 的 `readChapter` 返回 `{ meta: chapters[0], content: "" }`。）

`src/components/editor/ChapterEditor.tsx`：

```tsx
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import { useWorkspace } from "../../stores/workspace";
import { api } from "../../lib/tauri";
import { useAutosave } from "../../hooks/useAutosave";
import { countWords } from "../../lib/words";

export function ChapterEditor() {
  const { currentChapterId, chapterContent, chapters } = useWorkspace();
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    immediatelyRender: false,
  });
  const dirty = useRef<string | null>(null);
  const chapterIdRef = useRef<number | null>(null);
  chapterIdRef.current = currentChapterId;

  useEffect(() => {
    if (editor && chapterContent != null) {
      editor.commands.setContent(chapterContent);
      dirty.current = null;
    }
  }, [currentChapterId, chapterContent, editor]);

  const { status } = useAutosave(
    () => dirty.current,
    async (content) => {
      const id = chapterIdRef.current;
      if (id == null) return;
      await api.writeChapter(id, content);
    },
  );

  const meta = chapters.find((c) => c.id === currentChapterId);

  if (editor) {
    editor.on("update", () => { dirty.current = editor.storage.markdown.getMarkdown(); });
  }

  if (currentChapterId == null) {
    return <div className="flex h-full items-center justify-center text-[var(--fg-dim)]">选择或创建一个章节开始写作</div>;
  }

  const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ") ?? "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="font-medium">{meta?.title ?? ""}</div>
        <div className="text-xs text-[var(--fg-dim)]">
          {countWords(text)} 字 · {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : ""}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="mx-auto max-w-3xl px-8 py-6 leading-8" />
      </div>
    </div>
  );
}
```

（注：`editor.on("update", ...)` 放渲染路径外更好——实现时移入 `useEditor` 的 `onUpdate` 选项，避免重复注册；上述结构执行者应重构为 `useEditor({ onUpdate: ({ editor }) => { dirty.current = editor.storage.markdown.getMarkdown(); } })`，本步骤接受等价实现。需要 `pnpm add @tiptap/react@^2.26.0`。）

`src/components/editor/EditorPane.tsx` 替换为：

```tsx
import { ChapterEditor } from "./ChapterEditor";
export function EditorPane() { return <ChapterEditor />; }
```

- [ ] **Step 5: 运行测试与构建**

Run: `pnpm test && pnpm build`
Expected: 全部 PASS（autosave 2 + markdown 2 + store 3 + sidebar 1）

- [ ] **Step 6: 手动冒烟（含 IME 验证——关键）**

Run: `pnpm tauri dev`
操作：建书建章 → 输入中文长段（含中文输入法连续打字、候选词选择、回车上屏）→ 观察状态条「保存中…/已保存」→ 等待 2 秒后关闭应用 → 重启应用选同章节，内容完整。
**验收：中文 IME 打字过程中不丢字、不跳光标；重启后内容在。若丢字，立即停止并上报（WebView2 IME 风险，见规格书 §7）。**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: TipTap 编辑器 markdown 双向、防抖自动保存、字数状态条（含 IME 验证）"
```

---

### Task 7: rescan 索引重建、README 与打包冒烟

**Files:**
- Create: `src-tauri/tests/rescan_test.rs`、`README.md`
- Modify: `src-tauri/src/commands.rs`（rescan 命令）、`src-tauri/src/lib.rs`（注册）、`src/components/layout/Sidebar.tsx`（底部重建按钮）、`src/lib/tauri.ts`（`rescanLibrary`）

**Interfaces:**
- Consumes: Task 3 `scan_library`、Task 4 命令层
- Produces: `rescan_library` 命令（前端 `api.rescanLibrary(): Promise<number>` 返回章节数）；「重建索引」入口；README。规格书 §3「DB 可随时从文件重建」自此可验证。

- [ ] **Step 1: 写失败测试** `src-tauri/tests/rescan_test.rs`

```rust
use bixian::commands as cmd;
use bixian::fs_service as fsx;
use bixian::state::AppState;

#[test]
fn rescan_rebuilds_from_files_and_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    // 直接在磁盘造文件（模拟用户手动拷入书籍）
    fsx::create_book_dir(&s.root, "shou-cang", "收藏的书").unwrap();
    fsx::write_chapter(&s.root, "shou-cang/manuscript/0001-yi.md", "第一章内容。").unwrap();
    fsx::write_chapter(&s.root, "shou-cang/manuscript/0002-er.md", "第二章。").unwrap();

    let n = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n, 2);
    let books = cmd::list_books_inner(&s).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].title, "收藏的书");
    let chs = cmd::list_chapters_inner(&s, books[0].id).unwrap();
    assert_eq!(chs.len(), 2);
    assert_eq!(chs[0].title, "yi"); // 无 DB 记录时标题取文件名去序号与扩展名
    assert!(chs[0].word_count > 0);

    // 幂等：重跑不重复
    let n2 = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n2, 2);
    let books2 = cmd::list_books_inner(&s).unwrap();
    assert_eq!(cmd::list_chapters_inner(&s, books2[0].id).unwrap().len(), 2);
    assert_eq!(books2[0].id, books[0].id); // upsert 保持 id 稳定
}
```

- [ ] **Step 2: 运行确认失败**

Run: `cd src-tauri && cargo test`
Expected: 编译失败 `rescan_library_inner` 不存在

- [ ] **Step 3: 实现**

`src-tauri/src/commands.rs` 追加：

```rust
pub fn rescan_library_inner(s: &AppState) -> AppResult<i64> {
    let scanned = fs_service::scan_library(&s.root)?;
    let mut total: i64 = 0;
    for b in scanned {
        let book = {
            let conn = lock(s)?;
            match repo::books::get_by_slug(&conn, &b.slug)? {
                Some(existing) => existing,
                None => repo::books::create(&*conn, &b.title, &b.slug)?,
            }
        };
        for rel in b.files {
            let title = rel.rsplit('/').next().unwrap()
                .trim_end_matches(".md")
                .split_once('-').map(|(_, t)| t.to_string())
                .unwrap_or_else(|| rel.clone());
            let existing = {
                let conn = lock(s)?;
                let all = repo::chapters::list_by_book(&*conn, book.id)?;
                all.into_iter().find(|c| c.file_path == rel)
            };
            if existing.is_none() {
                let wc = crate::util::count_words(&fs_service::read_chapter(&s.root, &rel)?);
                let conn = lock(s)?;
                let created = repo::chapters::create(&*conn, book.id, &rel, &title)?;
                repo::chapters::touch_content(&*conn, created.id, wc)?;
            }
            total += 1;
        }
    }
    Ok(total)
}

#[tauri::command]
pub fn rescan_library(s: State<AppState>) -> AppResult<i64> { rescan_library_inner(&s) }
```

（注意：文件名标题规则——`0001-yi.md` → 标题 `yi`；`0001-初见.md` → `初见`。若文件名无 `-` 分隔，整个去扩展名文件名作标题。与测试断言一致。）

`src-tauri/src/lib.rs` 的 `generate_handler!` 列表追加 `commands::rescan_library`。

`src/lib/tauri.ts` 的 api 对象追加：

```ts
rescanLibrary: () => invoke<number>("rescan_library"),
```

`src/components/layout/Sidebar.tsx` 在章节列表容器后（组件最底部）追加：

```tsx
<div className="border-t p-2" style={{ borderColor: "var(--border)" }}>
  <button
    onClick={async () => {
      const n = await api.rescanLibrary();
      await loadBooks();
      alert(`已重建索引，共 ${n} 章`);
    }}
    className="w-full rounded px-2 py-1 text-xs text-[var(--fg-dim)] hover:bg-white/5">
    重建索引（从磁盘文件）
  </button>
</div>
```

（组件中需从 `useWorkspace()` 解构 `loadBooks` 与从 `../../lib/tauri` 导入 `api`。）

`README.md`：

```markdown
# 笔仙 Bixian

本地优先的 Rust 桌面 AI 长篇小说创作工具。人写为主、AI 辅助；人物图谱、伏笔追踪、灵感碰撞。

## 开发

    pnpm install
    pnpm tauri dev      # 开发运行（首次编译 Rust 约 2-5 分钟）
    pnpm test           # 前端测试
    cd src-tauri && cargo test   # Rust 测试
    pnpm tauri build    # 打包

## 数据位置

正文 markdown：`%APPDATA%/com.bixian.app/library/<书>/manuscript/*.md`（唯一真源，可随时用侧栏「重建索引」恢复数据库）。

设计文档：`docs/specs/2026-09-19-bixian-spec.md`；当前里程碑计划：`docs/superpowers/plans/`。
```

- [ ] **Step 4: 运行测试**

Run: `cd src-tauri && cargo test && cd .. && pnpm test && pnpm build`
Expected: 全绿

- [ ] **Step 5: 手动验收（M0 验收标准全流程）**

Run: `pnpm tauri dev`
1. 建书《测试书》→ 建 3 章 → 各写内容 → 自动保存
2. 关闭重启 → 书/章/内容都在
3. 退出应用 → 手动在 library 目录拷入一本书的文件夹 → 启动 → 点「重建索引」→ 新书出现且章节可打开
4. 删除一章 → md 文件同步消失

- [ ] **Step 6: 打包冒烟**

Run: `pnpm tauri build`（约 5-15 分钟）
Expected: `src-tauri/target/release/Bixian.exe` 生成且双击可运行（或 `pnpm tauri build --no-bundle` 后直接跑 exe）

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: rescan 磁盘重建索引、README、M0 打包冒烟通过"
```

---

## 计划自审记录

- 规格覆盖：M0 验收标准（建书/章、编辑保存、重启不丢、rescan、打包）分别由 Task 4/5/6/7 覆盖；规格 §4.1 磁盘布局由 Task 3 实现；§4.3 词数规则 Task 3/5 双端实现
- 占位符扫描：无 TBD/TODO；两处「以实现规则核对」的测试断言（word_count=10、count=6）已在步骤内给出确定值
- 类型一致性：`ChapterMeta` 字段 snake_case 贯穿 Rust/TS；命令参数 JS camelCase（bookId/newTitle）↔ Rust snake_case；`useAutosave` 签名在 Task 6 定义并被 ChapterEditor 按【注意】修正后的 onUpdate 版本一致使用
