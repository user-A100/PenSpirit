# Scrivener 3 结构交互研究（Binder / Corkboard / Outliner / Scrivenings）

> 调研日期 2026-10-01；依据 Scrivener 3 Windows 手册 Rev 3.1.6.0-02。

主要依据是官方《Scrivener 3 User Manual》Windows 版（Revision 3.1.6.0-02，2026 年 3 月）和 Mac 版。我把两份 PDF 全文提取出来，按章节逐段读过。另外参考了 L&L 官方博客、论坛和几份第三方教程，来源列在文末。

快捷键以 Windows 为准，括号里给 Mac 写法。Windows 手册里有一个私有字形，实际是 **Win 键**，所以像 Reveal in Binder 这类命令的快捷键是 Win+Shift+R。

---

## 0. 先纠正几个常见误解（逐条对照手册核实过）

| 常见假设 | 手册里的实际情况 |
|---|---|
| Enter 是重命名 | **Enter/Return 是新建同级条目**，可在 Behaviors: Return Key 里关掉。重命名用 **F2** 或双击（Mac 用 Esc 或双击），Enter 确认，Esc 取消。刚改完名想再建一个，要连按两次 Enter（§6.3.1） |
| Ctrl+Shift+N 新建文件夹 | 新建文本是 Ctrl+N（⌘N）；**新建文件夹是 Alt+Shift+N（⌥⌘N）**。Ctrl+Shift+N 是 New Project，Win+Ctrl+Shift+N 是从首选文档模板新建 |
| 按住 Alt 拖拽就是复制 | **默认不开启**，要在 Behaviors: Dragging & Dropping 里勾选 “Alt-dragging creates duplicates”。默认的复制方式是 Ctrl+D（§6.3.4、B.4.4） |
| Binder 有搜索过滤框 | **没有保留层级的 Binder 过滤**。Project Search（Ctrl+Shift+F）会把侧栏内容换成扁平的 “Search Results” 列表。Ctrl+F 的过滤只作用于编辑器里的 Corkboard/Outliner，结果也是扁平列表（§10.2.3、§11.4） |
| Binder 行内会显示状态、目标、进度 | **不显示**。Binder 能显示的只有：图标形态、标签色（圆点或整行底色）、子文档计数、分隔框、快照折角。字数和进度只在 Outliner 列、编辑器页脚和工具栏 Quick Search 条里显示。官方论坛的回答是 “You cannot make word counts show up directly in the Binder” |
| Quick Search 是 Ctrl+G | Windows 上是 **Win+Ctrl+G**（Edit ▸ Find ▸ Quick Search） |

---

## 1. 对象模型

### 1.1 一切都是 Binder 条目，文件和文件夹本质相同（§4.2.2、§7.3 “Folders are Files are Folders”）

- **类型**：文本、文件夹、媒体（图片/PDF/网页/音视频/不支持的文件）。
- **文件和文件夹几乎没有区别**：
  - 任何条目都可以同时有正文和子条目。
  - 带子条目的文本叫 file group（document with subdocuments）。
  - 右键 Convert to File / Convert to Folder 可以互转，信息不丢。
  - 文件夹关掉视图模式就是一个可以写字的正文编辑器。
  - 文件打开 Corkboard 后就能往下加子卡片，它也随之变成 file group。
- **默认行为差异**：
  - 点击文件夹会进入组视图；点击 file group 默认仍按单文档打开。
  - 选项 “Treat all documents with subdocuments as folders” 能让两者完全一致（B.4.5）。

### 1.2 三个根文件夹（§6.2）

三者都不能删除，也不能移进别的文件夹，但可以改名、互相调整顺序。

- **Draft**（模板里常叫 “Manuscript”）
  - 用独有图标识别，`Navigate ▸ Reveal Draft Folder`（Ctrl+Shift+R）可以直接定位。
  - Compile 时会被“缝合”成一份文件。
  - 只能放文本和文件夹；把媒体拖进 Draft 会被禁止。
- **Research**：非文本导入的默认位置。实际上 Draft 以外的任何地方都可以放资料。
- **Trash**
  - 删除（Ctrl+Del，Documents ▸ Move to Trash）是软删除。
  - Trash 有内容时图标变成“溢出”样式。
  - 回收站里的条目在搜索结果等地方以半透明（ghosted）图标显示。
  - 在 Trash 里选中条目后用 Edit ▸ Delete 才是单条永久删除；Project ▸ Empty Trash 清空全部。

### 1.3 每个条目携带的数据（§10.4、§13）

| 字段 | 要点 |
|---|---|
| Title | 可以留空，此时启用 **Adaptive Naming**：依次用 Synopsis 首行 → 正文首行 → “Untitled” 代替，用灰色斜体显示。Corkboard 上无标题的卡片标题位留空。代用标题默认不进入编译（§7.2） |
| Synopsis | 纯文本，也可以改用图片。Corkboard 卡片、Outliner 标题下方、Inspector 卡片显示的是**同一字段**。留空时卡片显示正文预览 |
| Notes | 每个条目一份富文本笔记，只在检视该条目时可见 |
| Label | 单选，带颜色。字段名可改，比如改成 “POV”，菜单名称会跟着变 |
| Status | 单选，无颜色，字段名可改。在卡片上显示为斜向印章 |
| Keywords | 多选，每个关键词有颜色。项目级关键词面板里可以嵌套整理，但这个层级只用于整理 |
| Custom Metadata | 四种类型：Text（可折行）、Checkbox、List、Date。可做 Outliner 列、过滤条件、搜索条件 |
| Include in Compile | 复选框 |
| Section Type | 默认按层级和类型自动推导（Structure-Based，灰色斜体显示），也可以手动覆盖（黑色正体）。容器可以设 Default Subdocument Type 作用于整棵子树（§7.6） |
| 创建/修改日期 | — |
| 文档目标 | 字数或字符数；可设最小目标、超额提示和容差；容器目标会汇总子树（§20.1.2） |
| Snapshots | 正文的历史版本，可比较差异、回滚 |
| Document Bookmarks | 文档级书签，链接是双向的（“Links are Circular”） |
| 链接型批注与脚注 | 在 Comments & Footnotes 标签里列出 |
| 其他 | 自定义图标、是否显示为 Binder 分隔块、锁定的组视图模式、Corkboard 模式和自由排布坐标（按容器保存）、默认子文档模板 |

**项目级设置**：Project Targets（全稿目标和本次写作目标，可设截止日期）、标签/状态列表、关键词表、自定义字段定义、Section Types、Collections、Project Bookmarks、文档模板文件夹。

### 1.4 稳定身份

- 每个条目有 **UUID**。外部链接格式是 `x-scrivener-item://…project.scriv?id=UUID`（§10.1.6）。
- 内部链接、Collection、书签都指向同一个原件，所以移动或改名不会断链。
- 重命名一个内部书签等于重命名原条目（§13.4.2）。
- `.scrivx` 文件只是项目的“地图”，内容按条目分文件存储（§5.1）。
- 跨项目拖拽复制时，标题、Synopsis、正文、Notes、关键词、标签、状态、自定义字段、快照、目标、编译开关都会保留（§6.3.4）。

---

## 2. Binder 交互细节

### 2.1 选择

**鼠标**（§6.3.2）：
- 单击是单选。Ctrl+点击（⌘）逐个增减。
- Shift+点击选区间，锚点始终是第一个选中的条目。例如先点 C 再 Shift 点 A，结果是 A–C。
- 两种修饰键可以组合：Ctrl 点击会重置锚点。

**键盘**：
- ↑↓ 在可见条目之间移动。
- ← 先折叠，已折叠时跳到父级；→ 展开。
- Shift+↑↓ 扩展或收缩选区，按起始方向可逆。
- Ctrl+Shift+↑↓（Mac ⌃⌥↑↓）在可见容器之间跳转。
- Mac 上 ⌥↑↓ 跳到列表顶部或底部。
- Ctrl+A 全选。Edit ▸ Select 里还有 Select with Subdocuments、Select ‘Included’ Subdocuments、Select Subgroups。

**选区本身是一等对象**（§6.4）：
- 多选后，编辑器标题栏显示 “Multiple Selection” 和一个专用图标。
- 拖这个图标就等于拖整个选区，顺序按 Binder 原顺序。
- 选区会进入后退/前进历史。
- 可以用 Documents ▸ Add to Collection ▸ New Collection 把选区存起来。

### 2.2 选择驱动编辑器（§4.1.2 “Left to Right Navigation”、§4.2、§6.4）

**从左到右的规则**：右边的面板只响应它紧左侧的面板。
- Binder 驱动编辑器，编辑器驱动 Inspector，反方向不成立。
- Inspector 检视的是编辑器里的选中卡片；没有选中时检视容器本身。

**组视图模式**（Group View Mode）：
- 工具栏上的三段按钮：Scrivenings（Ctrl+1）、Corkboard（Ctrl+2）、Outliner（Ctrl+3）。
- 点击已激活的那一段会关闭组视图，回到“单文档”模式。
- 规则是“最后用过的模式即偏好”，**每个分屏各自记一份**。
- 单个文本打开正文。
- 文件夹或多选按偏好模式打开；多选时偏好为单文档，则回退到 Scrivenings（媒体回退到 Corkboard）。
- 可以对某个容器 Lock Group View Mode（§12.2.2），它会永远用指定模式打开。

**多选时视图的行为**：
- 全是容器：Corkboard 变成堆叠模式（Stacked）；Outliner 可以展开子级；Scrivenings 包含全部子孙。
- 容器和文件混选：Corkboard 和 Outliner 都是扁平列表（这时可以跨来源按列排序）；Scrivenings 只包含显式选中的文本。手册还建议了一个技巧：想只编辑章节文件夹自身的正文时，随便再选一个文件，就能触发混选规则。
- 多选视图里**不能新建、不能重排**，也不能用自由 Corkboard，因为没有地方保存位置。但可以把条目拖出去移动。

### 2.3 Binder 与编辑器的同步：刻意不自动跟随（§6.3.3）

- Binder 保留你最后一次点击的高亮，作为“书签式”的回到原处入口。
- 展开/折叠状态和滚动位置完全由用户控制。
- 编辑器当前打开的文档如果在 Binder 里可见，会额外显示一个**较小的次级高亮**，可在 Appearance: Binder 里关闭。
- 文档位于折叠节点里时不做任何处理，不会自动展开。
- 需要强制同步时用 **Navigate ▸ Reveal in Binder（Win+Shift+R / ⌥⌘R）**：显示 Binder、切回主 Binder 标签、展开路径、选中条目，多选时也可用。
- 编辑器标题栏右键还有 Path 菜单，可以逐级选中祖先节点。

### 2.4 新建与放置规则（§6.3.1）

**新建入口**：
- 工具栏 Add 按钮（下拉里有 Folder 和文档模板）。
- Binder 底栏的 +文本、+文件夹、… 菜单。
- 右键菜单 Add 子菜单。
- Ctrl+N 新建文本、Alt+Shift+N 新建文件夹、Enter 新建。

**放置规则**：新条目相对于**当前活动视图的选中项**放置。即使正在编辑器里打字，也以正在编辑的文档为参照。
- 新建文件夹：总是作为同级。
- 选中文件夹时新建文本：作为子级，追加到末尾。
- 选中文件时新建文本：作为同级，紧跟其后。想变成子级就再按 Ctrl+→。
- 选中 Draft 或 Research 时：一律作为子级，避免误建在根级而不参与编译。
- 带 Default Subdocument Template 的容器（比如角色文件夹）：Ctrl+N 的菜单名会变成 “New Character Sketch”。

### 2.5 重命名

- 双击或 F2 进入编辑；Enter 或点击别处确认；Esc 取消。
- 也可以在编辑器标题栏直接改（Win+Shift+N 把焦点移过去，Enter 回到正文）。
- 也可以在 Inspector 卡片上改。
- 选中正文后 Alt+Win+Shift+T 可以把选中文字设为标题。

### 2.6 移动、复制与拖放（§6.3.4、§12.1.1、A.3 Move）

**拖拽**：
- 落点处显示**蓝色插入目标**，左右移动鼠标可以调节缩进层级。
- 拖到条目**上方**（drop-on）是放入成为子级；拖到文件上会让它变成 file group。
- 拖到条目**之间**（drop-between）是插入为同级。
- 在折叠的组上停顿片刻会自动展开（spring-loading）。
- 贴近 Binder 上下边缘会自动滚动。
- 多选拖拽会把条目按原顺序**聚拢**到落点。

**键盘移动**（Edit ▸ Move）：Ctrl+↑/↓/←/→（⌃⌘+方向键）。
- ↑↓ 在同级内移动，不能越出父容器。
- ← 提升层级，插在原父级之后。
- → 降级，嵌套到上一个兄弟之下。
- 多选不连续时用 ↑↓ 移动，会**保持相对间距**整体平移。
- 多选提升/降级会聚拢，要求所有条目在同一父级。
- 选区里任何一项不能移动时，整体都不移动。

**远距离移动**：
- Documents ▸ Move To ▸（二级菜单列出整棵树，顶部有 “Favorites” 常用目标），移到目标的子列表末尾。
- 用过一次后会出现 **“Move to ‘X’ Again”**。
- Copy To ▸ 用于复制；Copy to Project ▸ 用于跨项目复制。

**代理图标**：凡是能看到条目图标的地方（编辑器标题栏、卡片、Outliner 行、搜索结果、书签、Quick Search 结果），拖拽这个图标就等于拖拽条目本身（§6.3.4 “By the icon”、§E.10）。

**拖到不同目标的效果**：

| 拖到哪里 | 结果 |
|---|---|
| 正文编辑器 | 创建内部链接，Scrivener 3 不需要修饰键。多个条目每行一个链接；拖到选中文字上则把链接加到这段文字上 |
| 正文编辑器（按住 Alt/Option） | 粘贴该条目的内容 |
| 编辑器标题栏 | 在该分屏打开 |
| 编辑器标题栏（按住 Alt） | 在副本夹（Copyholder）打开 |
| Collection 标签 | 加入该集合 |
| Inspector 书签列表 | 建立书签 |
| 另一个打开的项目 | 连同元数据一起复制 |
| Binder（从外部拖文字） | 新建条目；拖到某个文本条目上则追加到它的正文（§E.12） |
| Binder（从资源管理器拖文件夹） | 递归导入 |

**结构命令**：

| 操作 | Windows | Mac |
|---|---|---|
| 复制条目（连子级、自动编号命名） | Ctrl+D | ⌘D |
| 复制条目（不含子级） | Ctrl+Shift+D | — |
| 把选中条目打包进新文件夹 | Alt+Shift+G（New Folder from Selection） | — |
| 解散容器（内容上提一级，容器保留） | Alt+Shift+U（Ungroup） | — |
| 在光标处拆分 | Ctrl+Shift+K | ⌥⌘K |
| 拆分，并用选中文字作新标题 | Alt+Shift+K | — |
| 合并（可以不连续，按 Binder 顺序） | Ctrl+Shift+M | — |
| 排序 | Edit ▸ Sort ▸ A–Z / Z–A（持久改变顺序） | 同左 |

拆分和合并的细节（§15.4）：
- 拆分时 Synopsis、Notes、快照留在前半段，其余元数据复制到新条目。
- 合并时 Synopsis、Notes、关键词、书签、快照会合并；标签、状态、标题等取最上面那一项。
- **拆分和合并都不能撤销**，只能互相抵消。

### 2.7 展开、折叠与 Hoist（§6.3.5、A.5 Outline）

- 点三角或用 ←→ 展开/折叠。按住 Alt 点击或配合方向键，会递归作用于整个子树。
- 展开状态会被记住；Outliner 按容器分别记忆。
- Expand All 是 Alt+]（⌘9），Collapse All 是 Alt+[（⌘0），Collapse All to Current Level 是 Alt+-（⌃⌘0）。
- **Hoist Binder**（View ▸ Outline ▸ Hoist Binder，Windows 上是 Alt+\）：
  - 侧栏只显示某个容器的子树，顶部出现带容器名的标题条。
  - 标题条上 × 退出，↪ 把容器载入编辑器。
  - Hoist 状态下改动的展开状态，退出后会被丢弃。
  - 在 Hoist 里做的结构修改直接作用于完整树。

### 2.8 Binder 的视觉编码（§7.1、§10.4.3、B.5.2）

- **图标形态**：
  - 文本：空白纸 → 有 Synopsis 时变成索引卡 → 有正文时变成带线条的纸。
  - 带子级的文本用“纸叠”变体。
  - 文件夹用小角标表示有 Synopsis 或有正文。
  - 有快照时图标**右上角折角**（dog-ear）。
- **标签色**（View ▸ Use Label Color In ▸）：
  - Binder：行右侧圆点，或整行底色（“Show as Background Color in Binder”）。
  - Icons：图标着色，全局生效。
  - Index Cards：卡片整张着色。
  - Outliner Rows：整行底色。
  - Scrivenings Titles：标题条着色。
- **其他**：
  - 容器可以加粗。
  - Show Subdocument Counts in Binder 显示**全部子孙**的数量。
  - 右键 “Show as Binder Separator(s)” 给条目加阴影框，作为长树里的地标。
  - 可以设自定义图标，或从文字/emoji 生成图标；Ctrl+Alt+右键弹出快捷图标菜单。
  - 可以调行距和缩进。

### 2.9 右键菜单（综合附录 A 中标注 “also available from the binder contextual menu” 的命令）

Add ▸（文本/文件夹/模板/Existing Files…）、Duplicate、New Folder from Selection、Ungroup、Move To / Move To X Again / Copy To、Convert to Folder/File、Change Icon、Label ▸ / Status ▸ / Section Type ▸ / 自定义 List 字段 ▸（**对选区批量赋值**）、Add to Collection、Add to Project Bookmarks、Show as Binder Separator、Reveal in Binder（在 Collection 和搜索结果里）、Open ▸（Other Editor / Copyholder / Quick Reference / External Editor）、Copy Document Link、Move to Trash。

### 2.10 Collections（侧栏标签页，§10.2）

- **开关**：Alt+Shift+C 显示标签列表。
- **标签种类**：
  - 固定的 **Binder** 标签。
  - 内置的 **Search Results** 标签：保存最近一次搜索条件，不能增删、不能重排。
  - **标准 Collection**：手动加入，可拖动排序或用 Ctrl+↑↓ 排序，**没有层级**。Del 只是移出集合，Ctrl+Del 是真正删到 Trash。
  - **Saved Search**：放大镜图标，每次查看时按条件重新生成。
- **视觉提示**：选中某个 Collection 后，侧栏背景和标题条染成集合色，提醒你“不在完整 Binder 里”。
- **载入编辑器**：标题条上 ↪ 把集合载入编辑器，当作文件夹看，能用全部三种视图；自由 Corkboard 的卡片坐标会保存到集合里。
- **在集合里新建**：条目会落到 Binder 根级的 “集合名 (Unsorted)” 文件夹。
- **“Mark and gather”工作流**：先用集合标记，再用 Move To 或拖回 Binder 一次性聚拢。也可以用来做实验性的章节重排，满意后再写回 Binder。

### 2.11 导航辅助

| 功能 | 快捷键与要点 |
|---|---|
| 历史 | 每个分屏各自持久保存，关掉分屏也不丢。Ctrl+[ / Ctrl+]（⌘[ / ⌘]）；按住箭头按钮弹出完整列表。Alt+{ / Alt+} 远程翻另一个分屏的历史 |
| Go To 菜单 | Navigate ▸ Go To，或标题栏右键。项目书签排在最前，下面是整棵树。始终作用于活动分屏，锁定的分屏也不例外 |
| Previous/Next Document | Alt+Shift+↑↓（⌥⌘↑↓），按侧栏当前列表顺序走，忽略层级。如果侧栏显示的是搜索结果，就在结果之间走 |
| Enclosing Group | Win+Ctrl+R（⌃⌘R），上升一级并选中原条目 |
| Go To Selection | Win+Shift+E，强制以单文档打开选中项，包括容器自身的正文 |
| Open in Other Editor | Ctrl+Shift+O |
| Quick Search | Win+Ctrl+G。工具栏上一个类似浏览器 URL 栏的框，结果按 Titles → Synopses → Text 分组。Enter 打开；Shift+Enter 在 Quick Reference 里打开；Alt+Enter 在另一个分屏打开。结果条目可以拖拽。Alt+点击这个框打开 Project Targets，框体上下边缘显示全稿和本次写作的进度条 |
| Composition Mode | F11，Esc 退出。当前 Scrivenings 会话会整体带进去。底部控制条里的 Go To 只列出当前会话的条目，并有独立的历史和浮动 Inspector |
| 分屏 | 只能二分：Ctrl+"（Windows 竖分）、Ctrl+'（Windows 关闭）。每个分屏独立保存视图模式、历史、Outliner 列、缩放。标题栏颜色：**蓝底 = 接收 Binder 点击，红底 = Lock in Place（Alt+Shift+L），下划线 = 当前活动** |
| Binder 点击作用于哪里 | Navigate ▸ Binder Selection Affects：Current / Other / Left-only / Right-only / Both / None，另有 “Open Non-Group Items in Other”。Alt+点击 Binder 条目会在另一个分屏打开，焦点不动 |
| 分屏联动 | Corkboard 或 Outliner 选中的卡片自动载入另一个分屏或副本夹，形成“三栏浏览器”（§12.2.5） |
| Copyholder（副本夹） | 每个分屏可以附一个，最多四个窗格。只显示内容本身，不显示组视图，不受 Binder 点击影响，用来“夹住”参考资料（§8.1.5） |
| Quick Reference | 独立的浮动窗口，数量不限，带迷你 Inspector（§12.6） |
| Bookmarks | 项目书签：工具栏按钮或 Ctrl+Shift+B。文档书签：Inspector 第二个标签，下方是**可编辑的预览**（§10.3、§13.4） |
| Saved Layouts | 保存窗口布局、分屏方式、Binder Affects 设置、Outliner 列、卡片外观等（§12.3） |

---

## 3. Corkboard（§4.2.4、§8.2）

### 3.1 卡片构成

- **三个核心元素**：图标、标题、Synopsis。
- **可选元素**：
  - 卡片序号（Show Card Numbers）。
  - 左侧标签色条（F9 切换）。
  - Status 斜向印章（Alt+F9）。
  - 右侧关键词色“胶带”（Shift+F9）。
  - 整张卡片按标签着色。
- **容器卡片**画成“一叠卡片”的样子，双击图标可以钻进下一层。

### 3.2 编辑

- 双击标题或 Synopsis 进入编辑。
- Tab / Shift+Tab 在标题和 Synopsis 之间切换，还会跳到下一张或上一张卡片（首尾循环）。
- Enter 或 Esc 确认。
- Synopsis 里换行用 Alt+Enter（§8.2.1）；附录 B.4.8 写的是 Ctrl+Enter，两处不一致，以实测为准。
- 显示正文预览的卡片一旦开始编辑，预览就消失。可以先用 Auto-Fill ▸ Set Synopsis from Main Text 把预览转成真实 Synopsis。

### 3.3 键盘与新建

- 方向键移动选择，Shift+方向键扩展选择。
- Ctrl+方向键按空间方向移动卡片：←→ 沿行移动并在行间折返，↑↓ 垂直移动。
- 不在编辑状态时按 Enter 会新建卡片。
- 双击背景的行为可配置：无动作（默认）、新建卡片、或返回父级 Corkboard。
- 开启 “Allow drop ons in corkboard” 后，可以把卡片拖到另一张卡片上，变成它的子级。

### 3.4 三种模式（按容器记忆，在页脚切换）

**Linear（网格）**：
- 卡片顺序就是 Binder 顺序。拖动卡片等于移动正文。

**Freeform（自由）**：
- 卡片可以随意摆放，**不影响**大纲顺序。
- 框选（marquee）或 Ctrl+点击多选。
- Snap to Grid 对齐网格；多选拖动时只有鼠标下那张卡片吸附。
- 点 **Commit** 按“左→右”“上→下”等规则把空间顺序写回 Binder。提交后自由布局本身保持不变。
- 卡片序号始终反映大纲顺序。
- 多选和搜索结果里不能用这个模式，因为没有地方存坐标。

**Arrange by Label（标签轨道）**：
- 每个标签一条带颜色的“线”，第一条是“无标签”。
- 横向位置 = 文件夹内顺序，**每列只能有一张卡片**。
- 沿轨道拖动改变顺序；跨轨道拖动改变标签。
- Ctrl+←→ 改顺序，Ctrl+↑↓ 改标签。
- 双击轨道会在该处插入一张已带该标签的新卡片。
- 轨道可以横排或竖排。

### 3.5 卡片选项与堆叠

- **Corkboard Options 弹窗**：
  - Card Size（尺寸）。
  - Ratio（宽高比，默认 6×4）。
  - Spacing（间距）。
  - Cards Across（每行卡片数：Auto / 1–10 / Other）。
  - Size to fit editor（随编辑器宽度缩放）。
  - Keyword chips（最多显示几条关键词）。
- 两种布局策略：固定尺寸自动换行，或固定每行张数自动缩放。
- 设置随项目保存，也可以存进 Layout。
- **Stacked Corkboards**：选多个容器时出现，用分隔线隔开。
  - 布局可选 Grid、Horizontal（每个容器一行，横向滚动）、Vertical（每个容器一列）。
  - Number Per Section 控制编号是否按容器重新开始。
  - 标题栏的内容导航按钮会列出每一叠，可以直接跳转。
- 图片条目和图片 Synopsis 显示为缩略图。

---

## 4. Outliner（§4.2.5、§8.3）

- **范围**：显示所选容器的**所有子孙**（多层级），这一点和 Corkboard 只看一层不同。展开状态按容器记忆。默认是标题加粗，下面浅色显示 Synopsis 或正文预览。
- **可用列**：
  - Title，可附加 “and Synopsis”、“with Icons”、“with Numbers”（层级编号 1.1.2）。
  - Label、Status（下拉可编辑）。
  - Section Type（下拉可编辑，斜体表示自动推导）。
  - Keywords（色块或名称）。
  - Created、Modified。
  - Word Count、Character Count、**Total Word Count / Total Character Count**（含全部子孙）。
  - Include in Compile（复选框）。
  - Target、Target Type、**Progress / Total Progress（进度条）**、Total Target。
  - 全部自定义字段。
- **管理列**：
  - 点右上角 › 或用 View ▸ Outliner Options。
  - 拖表头重排，拖分隔线调宽，双击分隔线自动适配宽度。
  - **列配置按分屏保存**，也可以存进 Layout。
  - 只有标题一列时，它自动占满全宽。
- **行内编辑**：
  - 双击或 F2 编辑标题和 Synopsis，方向键在两者之间移动，Enter 退出。
  - 下拉列直接点选。
  - **Alt+点击复选框会切换所有可见行**；先选中若干行再 Alt+点击，则只改选中的行。
  - 批量改 List 类字段：先多选，再用右键菜单。
- **排序**：点表头依次是升序 → 降序 → 取消。**只是视图排序**，不改变 Binder 顺序，下次打开项目时不保留。要持久排序用 Edit ▸ Sort。
- **其他**：
  - Fixed Row Height 模式，类似 iOS 列表，行高固定。
  - 页脚有 +文本、+文件夹、… 菜单、auto-load 联动按钮，以及“共 N 项 / 选中 M 项”计数。
  - 右键多选条目时，菜单底部用灰字显示这些条目的合计字数和字符数（§20.1）。
- **过滤栏**（Ctrl+F，§11.4）：
  - 按可见文字过滤，可选同时搜正文和 Notes，可用正则。
  - 可按是否在 Draft 内、是否 Include in Compile 过滤。
  - 可按 Label、Status、Section Type、自定义 List/Checkbox 字段做 Include / Exclude 过滤。
  - 过滤结果是扁平列表，**不能重排、不能新建**；自由模式和标签模式在过滤期间会退回普通列表。
  - 结果不会自动刷新，要手动点刷新按钮。
  - Esc 先清空文字，再按一次关闭过滤栏。

---

## 5. Scrivenings（§4.2.6、§15.5）

- **本质**：把多个文本按 Binder 顺序**扁平化**拼成一个长文档，子孙会一并展开，就像读者读到的那样。编辑时实时写回各自的文档，没有“保存会话”的概念。
- **分隔**：
  - 默认用虚线分隔，分隔线不能编辑也不能拖动。可以改成“Corners”裁切标记，或配合标题使用。
  - View ▸ Text Editing ▸ Show Titles in Scrivenings 会插入标题；标题字号随嵌套深度递减，可以按标签着色。
  - 容器自身的正文默认排在最前，可以关掉。
- **编辑边界**：**所有编辑命令都不能跨越文件边界**，跨边界的选区不能覆盖输入、删除或替换。剪切粘贴和拖拽文字可以跨边界移动内容。
- **标题栏**：灰色部分是容器名（右键作用于整个组），黑色部分是当前段落所属文档的名字，可以直接改名。
- **导航**：
  - “Jump to Scrivening”按钮弹出本会话的小目录。
  - **Ctrl+1/2/3 切换视图时位置保持对应**：在 Corkboard 选中某张卡，回到 Scrivenings 就跳到那一段。
  - Edit ▸ Select All 只选中当前段落。
  - Go To Selection 只看这一段；Enclosing Group 把会话扩大到上一级。
  - 编辑器锁定时，点击 Binder 里属于本会话的条目，只滚动到那一段，不会换掉会话。
- **其他**：
  - 页脚字数统计整个会话；有选中文字时只统计选中部分，并换色提示。
  - 目标进度条会汇总会话内各文档的目标。
  - 会话里新建或拆分文档，新的分隔线立刻出现；被移到 Trash 的文档自动从会话里消失。
  - 可以整体带进 Composition Mode。
  - Navigate ▸ Open ▸ With Compilable Subdocuments 只看要编译的内容（§12.4）。

---

## 6. Inspector（§4.1.5、§13）

- **检视对象**：活动编辑器（或活动副本夹）里的当前选中项。以下情况会回退显示项目书签：Collection、搜索结果、多选、根文件夹。可以用 Lock Inspector to Editor 把它固定到某个分屏，被固定的分屏标题栏会显示红色 “i”。
- **五个标签**，每个标签都有快捷键，按一次显示，按两次聚焦：
  1. **Notes**：上面是 Synopsis 卡片（可编辑标题和 Synopsis，Ctrl+7 在文字和图片之间切换），下面是富文本 Notes。
  2. **Bookmarks**：文档书签和项目书签（Ctrl+6 切换）。下方预览区对内部文本**可以直接编辑**。
  3. **Metadata**：General（创建和修改日期、Include in Compile、Section Type）、Custom（字段表单，Tab 在字段间移动）、Keywords（Enter 新增，Del 移除，拖拽调整顺序；顺序决定卡片上显示哪几条胶带）。
  4. **Snapshots**：Ctrl+5 拍快照，Ctrl+Shift+5 拍带标题的快照。支持与正文对比，或两张快照互相对比，粒度可选段落、从句、词，有“下一处差异”跳转。可以 Roll Back，回滚前会提示先给当前正文拍一张快照。
  5. **Comments & Footnotes**：列出当前编辑器里全部文字的链接批注和脚注。在 Scrivenings 里会汇总整个会话，点击就滚动到对应位置，可以当作临时书签用。
- **其他**：
  - 标签按钮右上角的小圆点表示该标签里有内容。
  - 底部始终有 Label 和 Status 下拉。
  - 各区块可以折叠、调整高度。
  - 不相关的标签会自动隐藏，比如看图片时没有脚注标签。

---

## 7. 设计原则：为什么它被视为长篇写作结构的标杆

1. **整个项目只有一棵树，所有东西都是“条目”**。文件和文件夹的区别被压到最低，结构可以渐进生长：先写碎片，再长出章节，与官方《Philosophy》章里 Hilary Mantel 所说的 “growing a book” 相对应。Draft 根节点是唯一和“书稿”绑定的语义；Section Type 由层级自动推导，所以拆得多细都不会在输出里留下痕迹（§15.4 的表述是 “Splitting almost never comes with drawbacks”）。
2. **视图只是透镜，数据只有一份**。Corkboard、Outliner、Scrivenings、Collection、搜索结果都只是同一批条目的投影：移动卡片就是移动正文，Synopsis 在每个地方都是同一个字段。视图偏好按分屏和容器记忆，锁定也只锁视图，不复制数据。
3. **选择驱动、从左到右单向流动**。点击 Binder 决定编辑器显示什么，编辑器里的选择决定 Inspector 显示什么。选区本身可以拖拽、进入历史、存成集合。
4. **结构编辑廉价**：
   - 新建只要一个 Enter。
   - 移动有五种以上的通道：拖拽、Ctrl+方向键、Move To、“Move to ‘X’ Again”、代理图标。
   - 打包、解散、拆分、合并、复制，以及软删除到 Trash。
   - 可以先在自由 Corkboard 或 Collection 里实验，再 Commit 或聚拢回 Binder。
   - Outliner 排序和过滤都是非破坏性的。
   - 不足之处：拆分和合并不能撤销，靠快照兜底。
5. **元数据在每个视图里的表达一致**。标签色可以同时染到 Binder、图标、卡片、Outliner 行和 Scrivenings 标题；代用标题在每个地方都遵循同一套降级规则；同一个状态在卡片上是印章，在 Outliner 里是一列。
6. **Binder 是用户自己掌控的工作台**。它不会自动跟随编辑器展开或滚动，只用被动的次级高亮提示，需要时再用 Reveal in Binder 主动同步。
7. **图标即代理、条目身份稳定（UUID）**，所以链接、书签、集合、跨项目复制都不会断。

---

## 8. 现代工具做得更好的地方（可作为超越点）

- **Binder 行内信息太少**。Binder 不能显示字数、进度或状态（论坛回答：没有办法，请用 Outliner）。
  - Ulysses：组和稿件旁边都有**目标进度圆环**，开写时蓝色、达标绿色、超额红色；组目标和项目目标在库侧栏里显示，还可以设“每天”目标。
  - 建议：章节树行尾直接显示字数和进度环，悬停显示状态。
- **没有保留层级的侧栏过滤**。Scrivener 的搜索会把树替换成扁平列表，Ctrl+F 过滤只能在编辑器里用。
  - Ulysses 的 Filter 是放在某个组里的“智能组”，只作用于这个组的子树。
  - Novelcrafter 的 Plan 视图有一个统一搜索，覆盖梗概、正文、标签和 Codex 条目名及别名。
  - 建议：在树上做实时过滤，命中项高亮、祖先节点保留、其余节点淡化。
- **只有一维的结构矩阵**。Scrivener 的标签轨道只能看一个维度。
  - Novelcrafter 的 **Matrix** 以场景为行、以人物/地点/支线/POV 为列，一键修改 POV，能直接看出谁在哪些场景出现，比如反派是否出场过早。
- **当前文件的定位方式**。Obsidian 文件树可以自动定位并高亮当前笔记（auto-reveal），有一键全部展开/折叠。Scrivener 刻意不自动跟随，这在 Scrivener 里是有意的设计。建议做成可选项。
- **拖拽反馈**。Scrivener 只有蓝色插入线和悬停展开，没有让位动画和实时重排预览，Corkboard 网格也一样。现代 Web 拖拽普遍有其他条目实时让位的动画和清晰的 drop-on / drop-between 分区。这一条是普遍经验的判断，不是逐款核实的对比。
- **学习成本和快捷键冲突**。Binder Selection Affects、Copyholder、锁定等概念很强大，但不容易被发现。Windows 版用 Win 键的快捷键已经和系统冲突：Win+Shift+R 会触发截图工具，官方承认了这个问题。

## 9. 对中文小说应用的落地要点

1. 用“容器 = 文档”的统一模型：卷、章、节都可以写正文、挂梗概。
2. 侧栏选中项驱动右侧视图；多选自动进入连续阅读，或卡片 / 大纲视图。
3. 四个方向的移动快捷键，配合 Move To 和“再次移动到 X”。
4. 拖拽时清楚区分插入线（同级）和高亮（放入）；悬停自动展开；靠近边缘自动滚动。
5. 新建遵循“选中卷就建子章、选中章就建同级章”的放置规则。
6. 标签色、状态、梗概在树、卡片、大纲、连续阅读里表达一致。
7. 对树做非破坏式过滤；行内显示字数和进度；提供 Hoist 聚焦单卷；提供“在目录中定位”。
8. 拆分和合并要支持撤销，补上 Scrivener 的短板。

---

## 来源

- 《Scrivener 3 User Manual for Windows》Rev. 3.1.6.0-02（2026-03），https://www.literatureandlatte.com/docs/Scrivener_Manual-Win.pdf ：Ch.1 Philosophy；§4.1.2–4.2.6（Left to Right Navigation、View Modes）；Ch.6 The Binder & its Outline（§6.2 Three Root Folders、§6.3.1–6.3.5、§6.4 Multiple Selections）；Ch.7（§7.1 Binder Icons、§7.2 Adaptive Naming、§7.3 Folders are Files are Folders、§7.6 Section Types）；Ch.8（§8.1.1 Header Bar、§8.1.4 Splitting、§8.1.5 Copyholders、§8.2 Corkboard、§8.3 Outliner）；§10.1 Linking、§10.2 Collections、§10.3 Bookmarks、§10.4 Metadata；§11.4 Filter、§11.5 Quick Search；Ch.12 Project Navigation；Ch.13 Inspector；§15.4 Split/Merge、§15.5 Scrivenings；§16.1 Composition Mode；§20.1 Targets；附录 A.3/A.5/A.6/A.7/A.8 菜单；B.4.3–B.4.8、B.5.2；E.10、E.12
- 《Scrivener 3 User Manual for Mac》，https://www.literatureandlatte.com/docs/Scrivener_Manual-Mac.pdf （Mac 快捷键：§6.3、附录 A）
- L&L 博客：[5 Ways to Move and Rearrange Files and Folders in the Binder](https://www.literatureandlatte.com/blog/5-ways-to-move-and-rearrange-files-and-folders-in-the-scrivener-binder)、[Outlining with the Scrivener Binder](https://www.literatureandlatte.com/blog/outlining-with-the-scrivener-binder)、[Organize Your Project with the Corkboard](https://www.literatureandlatte.com/blog/organize-your-scrivener-project-with-the-corkboard)、[Plan Your Project with Scrivener’s Outliner](https://www.literatureandlatte.com/blog/plan-your-project-with-scriveners-outliner)、[7 Ways to View Word Counts](https://www.literatureandlatte.com/blog/7-ways-to-view-word-counts-in-scrivener-projects)
- L&L 论坛：[Show word count in binder?](https://forum.literatureandlatte.com/t/show-word-count-in-binder/130252)、[Keyboard Shortcut for Reveal In Binder Not Working](https://forum.literatureandlatte.com/t/keyboard-shortcut-for-reveal-in-binder-not-working/135901)、[Filter columns & other progress tracking（Wish List）](https://literatureandlatte.com/forum/viewtopic.php?t=22283)
- 第三方：Gwen Hernandez [Scrivener 3 Jump-Start (Windows)](https://gwenhernandez.com/wp-content/uploads/2022/11/WINDOWS-Scrivener-3-Jump-Start.pdf)、[Scrivener For Dummies – Scrivenings](https://www.oreilly.com/library/view/scrivener-for-dummies/9781118312469/a15_12_9781118312469-ch06.html)、[Scrivener’s Forgotten View: The Outline](https://writersinthestormblog.com/2019/09/scriveners-the-outline/)
- 对比产品：Ulysses [Goals](https://help.ulysses.app/goals)、[Sheets & Groups](https://help.ulysses.app/567894-sheets-groups)、[Filters](https://ulysses.app/tutorials/filters)；Novelcrafter [Plan Views](https://www.novelcrafter.com/help/docs/plan/plan-views)、[Planning with the Matrix](https://www.novelcrafter.com/help/docs/plan/planning-with-the-matrix)；Obsidian [File explorer](https://obsidian.md/help/Plugins/File+explorer)

（项目文件未做任何修改。提取的手册文本只存放在会话临时目录。）
