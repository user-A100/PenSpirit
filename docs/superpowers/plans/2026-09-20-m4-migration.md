# M4 功能迁移计划：books-reader + webnovel-writer

> **目标：** 把两个参考项目中经受过大规模使用检验的能力成体系地迁移进笔仙，聚焦四个字：**数据安全、长篇一致性、阅读审稿、导入健壮**。
>
> **来源盘点：** 2026-09-20 两轮 Explore 盘点（books-reader = Koodo Reader fork，闭源 kookit 引擎外围；webnovel-writer = Claude Code 插件，无编辑器，强在数据模型与 Git 备份）。

## 迁移总表（价值 × 成本）

| # | 功能 | 来源 | 价值 | 成本 | 落点 |
|---|---|---|---|---|---|
| A1 | Git 章节版本体系（每章 commit+tag、任意回滚、平行世界分支） | webnovel-writer `backup_manager.py` | ★★★★★ | 高 | Rust git2 + 现有 .history 升级 |
| A2 | 伏笔债务模型（紧急度分四态已有；补「放行需登记还债章」Override 合约） | webnovel-writer `index_debt_mixin.py` | ★★★★ | 低 | foreshadows 表加列 |
| A3 | 实体/别名/关系/出场数据模型 | webnovel-writer 17 表 schema | ★★★★★ | 中 | 人物图谱底座重做 |
| A4 | 角色出场/掉线统计（缺席章数排行） | webnovel-writer `status_reporter.py` | ★★★★ | 低 | 出场表聚合 + 图谱页卡片 |
| B1 | TTS 朗读审稿（系统 speechSynthesis 起步，句级高亮） | books-reader `ttsUtil.ts` | ★★★★★ | 中 | 阅读模式工具栏 |
| B2 | 对话符号着色（引号区间染色的可配置规则） | books-reader `symbolColorUtil.ts` | ★★★★ | 低 | 阅读渲染层 |
| B3 | 阅读书签/标注（选区高亮五色+备注，跳转） | books-reader `noteUtil.ts` | ★★★ | 中 | 阅读模式 |
| B4 | 老板键（全局快捷键瞬间隐藏窗口） | books-reader `system_cmds.rs` | ★★★★ | 低 | Tauri global-shortcut |
| B5 | 快捷键重绑系统（冲突检测） | books-reader `shortcutUtil.ts` | ★★★ | 中 | 设置页 |
| B6 | 打字机滚动（编辑器当前行居中） | 作家助手逆向 | ★★★ | 低 | TipTap 插件 |
| C1 | TXT 分章正则升级（英文 Chapter/Part、"1.标题"式、行宽≤140 防误判） | books-reader `txtChapterParser.ts` | ★★★★ | 低 | porting/import.rs |
| C2 | 自定义分章正则（多条命名规则按书指定） | books-reader 设置页 | ★★★ | 低 | settings + import |
| C3 | 文件夹成书导入（一章一文件按自然序合成） | books-reader `folderBook.js` | ★★★★ | 低 | 导入向导第三入口 |
| C4 | 导入查重（内容 MD5 防重复入库） | books-reader `importLocal` | ★★★ | 低 | Rust 侧 |
| D1 | 章摘要分层 + 注入预算（最近 N 章摘要进续写上下文） | webnovel-writer 记忆体系 | ★★★★★ | 中 | AI 面板上下文槽 |
| D2 | Anti-AI 味检查（8 瘾 5 查 + 词频终检） | webnovel-writer anti-ai-guide | ★★★★ | 低 | 编辑器顶栏「检查」旁 |
| D3 | 占位符扫描（[待…]/（暂名）写前阻断） | webnovel-writer `placeholder_scanner.py` | ★★★ | 低 | 同上 |
| D4 | 追读力登记（章末标记钩子类型/强度、爽点） | webnovel-writer `index_reading_mixin.py` | ★★★ | 中 | 章元数据 + 统计页 |

## 不迁移清单（明确排除）

- 云盘同步 17 种、OPDS/Legado/微信读书/ZLibrary 在线生态（阅读器专属）
- PDF/OCR/漫画格式（非写作场景）
- 插件系统、Discord RPC、账号配额
- RAG 向量检索（依赖云 Embedding；本地化等 ONNX 成熟再议，BM25 全文搜索已覆盖）
- webnovel-writer 的 Claude Code 插件机制本身（笔仙有自己的 ACP agent 体系）

## 执行顺序（依赖关系驱动）

1. **第一批（数据底座）：** C1→C2→C3→C4（导入链路一口气做完）+ A2 + D3（都是 Rust 侧小改）
2. **第二批（一致性）：** A3→A4（出场表先建，图谱与统计一起吃）+ D1
3. **第三批（阅读审稿）：** B1→B2→B6→B4
4. **第四批（重头）：** A1 Git 体系（动 .history 架构，放最后单独做）+ B3/B5/D2/D4

## 任务分解（第一批）

### T1: TXT 分章正则升级（C1）

**Files:** `src-tauri/src/porting/import.rs`（改 `is_chapter_heading`/`is_volume_heading`/`heading_of`）

- 英文标题：`Chapter N`/`Part N`/`Volume N`/`Prologue`/`Epilogue`（大小写不敏感，行首）
- `1. 标题` / `1、标题` / `一、标题` 式数字/中文序号开头（后跟非正文标点）
- 行宽防误判：标题行 ≤140 字符才认
- 同步更新单测（Rust）

### T2: 自定义分章正则（C2）

**Files:** settings 表加 `customChapterRules`（JSON 数组）；`import.rs` 预览/导入前合并用户规则；设置→导入 页面增删改命名正则

### T3: 文件夹成书导入（C3）

**Files:** ImportWizard 加「选文件夹」按钮（plugin-dialog `open({directory: true})`）；Rust `preview_import_dir`（按自然序排 *.md/*.txt，文件名（去序号）作章题）；复用 import_chapters 落库

### T4: 导入查重（C4）

**Files:** chapters 表加 `content_hash`；导入时对同书已有章 hash 比对，预览列表标「疑似重复」默认不勾选

### T5: 伏笔还债登记（A2）

**Files:** foreshadows 加 `override_note`/`repay_chapter_id`；紧急度逻辑纳入「已登记还债章」状态；面板 UI 一列

### T6: 占位符扫描（D3）

**Files:** 前端正则扫描 `[待…]/（暂名）/{…}`，编辑器顶栏「检查」下拉加一项，命中列表跳转

---

*第二/三/四批任务在第一批验收后细化。*
