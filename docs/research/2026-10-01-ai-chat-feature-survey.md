# AI 写作产品聊天交互调研与缺失清单

> 调研日期 2026-10-01。

# 中文长篇小说 App 底部 AI 对话栏：缺失功能调研清单

说明：
- 以下都来自官方文档、帮助中心或 changelog，第三方来源会注明。引用编号见文末。全程没有改动任何文件。
- 为了让命令建议能落到实处，我只读了项目的 `src-tauri/migrations/*.sql`，确认库里已经有这些表：characters、character_relations、places、outlines、plot_blocks、foreshadows、ideas、materials、styles、keywords、bump_words（灵感碰撞词，不是禁用词）。
- 有几处信息已经过时，用的时候要注意：
  - Cursor 2.0 删掉了 @Web、@Past Chats、@Git [6]。
  - Zed 的 text threads（连同它的 slash 命令）在 2026 年被移除 [32]。
  - 有第三方报道说 ChatGPT Canvas 已被替换，官方尚未确认 [28]。
  - Claude Styles 正在迁到 Skills，目前只有第三方报道 [30]。
  - Notion 的菜单项名称已经改过 [9][12]。

---

## 一、各产品的对话/AI 交互功能

**Cursor** [1][2][3][4][5][7][8]
- **模式与模型**：有 Agent / Ask / Plan / Debug 几种模式，模型选择器带 Auto 选项（CLI 用 `/model`）。
- **@ 上下文**：可以 @ 文件、文件夹、代码符号、Docs。`Ctrl+Shift+L` 把编辑器选区加入对话。
- **Cmd-K 内联编辑**：选中代码、输入指令、回车后直接改到原位。`Alt+Enter` 改成只提问。可以继续追加指令迭代。`Cmd+L` 带着选区升级到 Agent 对话。
- **改动审阅**：改动会立即写进文件，用 Keep / Undo 确认。可以逐处 Keep/Undo，也可以逐文件（Keep File / Undo File）。对话底部有 Keep All / Undo All / Review。
- **检查点**：大改之前自动快照。点时间线上的检查点可以预览，然后 Restore。恢复只回滚文件，不删消息。
- **排队与插话**：Enter 把消息排队，`Cmd+Enter` 立刻插话，引导正在进行的这一轮。`/btw`、`/side` 开侧聊。
- **上下文用量**：`/summarize` 压缩上下文。输入框旁有"上下文环"，点开能看到 token 按 system / rules / conversation 等类别拆分。
- **规则与命令**：Rules 分 Always、Apply Intelligently、按 glob、手动 @ 四种。`/create-rule` 自动生成规则。自定义命令放在 `.cursor/commands/*.md`，会出现在 `/` 菜单里。

**Notion AI** [9][10][11][12]
- **唤起**：空行按空格输入提示；选中文字用 "Edit with AI"（旧版是 Ask AI / `Ctrl+J`）。
- **旧版预设**：Improve writing、Fix spelling & grammar、Make shorter、Make longer、Change tone（Professional / Casual / Straightforward / Confident / Friendly）、Simplify language、Translate、Summarize、Continue writing、Explain。
- **新版预设**：Improve Writing、Proofread、Explain、Reformat，团队自建的 skill 可以加进菜单。
- **结果处理**：Replace selection、Insert below、Continue writing、Make longer、Try again、Discard。每次 Try again 都算一次额度。
- **Agent 面板**：可切侧栏或浮窗。能 @ 页面、人、日期，有来源选择器，模型可选 "Auto"。

**NovelAI** [13][14][15][16]
- **生成操作**：Send（`Ctrl+Enter`）；Retry（`Alt+R`）每次给出全新结果；Undo/Redo 在"分支时间线"式的编辑历史里前后移动；History 按钮显示当前位置有几次生成，可以选从哪一支继续；`Ctrl+Shift+Enter` 在文中间做内联生成，会参考光标前后的文本。
- **Token Probabilities**：按概率高、中、低着色。打开 Editor Token Probabilities 后，可以在正文里点某个 token 换成备选词，模型从这里往后重新生成。
- **Memory 和 Author's Note**：Memory 放在上下文最前面，存长期设定。Author's Note 插在接近末尾的位置，影响力最强，适合放短期走向。
- **Lorebook**：
  - 触发：关键词默认不分大小写，支持 `/正则/` 和 `&` 多键同时出现；可设 Always On。
  - 范围与位置：搜索范围最多 10000 字符；可以按关键词出现的位置插入。
  - 预算：每条有 token 预算和预留 token，Insertion Order 决定谁先占预算。
  - 其他：分类、Phrase Bias、级联激活；侧栏有快速检索。
- **上下文查看器**：分 Last / Current Context，按 Stage 逐步查看拼装过程。列有 Order、Inclusion、Reason（为什么被包含或排除）、Reserved、Tokens、Trim Type。
- **其他**：Config Preset，Genre & Tags。

**Sudowrite** [17]–[23]
- **Write**：
  - 三种模式：Auto；Guided（读光标前最多 1000 词，给出 3 个"接下来怎么写"的建议）；Tone Shift。
  - 设置：创造力、卡片数 1–6、卡片长度、Prose Mode（即模型）。
  - 结果进入右侧 History 栏，形式是卡片，点 Insert 才插入正文。插入后 AI 文字显示为紫色，直到作者改过。卡片可以加星收藏。
- **Describe**：视觉、听觉、触觉、味觉、嗅觉、比喻各出一张卡，每种感官可以单独关掉。
- **Rewrite**：选区最多 6000 词，预设有 Rephrase / Shorter / More descriptive，也可自定义指令，可设一次出几张卡。
- **Expand**：把选区写长并补充细节。
- **Brainstorm**：👍 加入 Keepers 清单，👎 换掉一条，最后 Save & Exit 存成一张卡。
- **选区菜单**：Related Words（单词同义词云）、Comment、Visualize。
- **Quick Edit**（`Cmd+K`）：最多 1000 词，原地修改，原文以删除线保留在旁边，可以接受、拒绝或继续细化。
- **Chat**：
  - 在右栏，会话按项目保存，`+` 新建，时钟图标看历史。
  - 用 `#` 提及人物、世界观、文档。有选区时会聚焦选区，同时保留全局上下文。
  - 两种模式："Chat only" 只聊天不改稿、不耗额度；"Allow edits" 可以改文档、改 Story Bible、加批注。
- **Story Bible**：Braindump / Genre / Style / Synopsis / Characters / Worldbuilding / Outline。
- **Saliency Engine**：自动挑出和当前任务相关的卡片，不会全塞进上下文。卡片和单个字段都有"眼睛"开关，可以对 AI 隐藏，比如凶手动机，避免 AI 提前剧透。
- **Story Bible Detection**：正文里认出的人物、设定加下划线。
- **Chapter Continuity**：章节串联后，最多回看 2 万词、25 个前序文档。超出预算时依次丢弃世界观、人物、前文。
- **其他**：Draft（按 Scenes 一次生成整章）、Canvas、Plugins（模板变量如 `{{previous_document_text}}`）。

**Novelcrafter** [24]–[27]
- **Codex**：文本或节拍里出现条目名称或别名时自动注入；场景摘要下可以用 +Codex 手动挂条目。
- **正文里的 `/`**：可选 Scene Beat 或 Continue Writing。生成后有 4 个按钮：
  - Apply：采纳进正文。
  - Retry：重新生成，覆盖上一版且无法找回。
  - Discard：丢弃。
  - Section：存成片段并采纳。
- **停止**：中途 Stop，已生成的部分会保留。
- **选区工具**（至少选 4 个词）：
  - Expand：可设扩写倍数。
  - Rephrase：切换视角/时态、加内心独白、转成对话、被动改主动、换个说法、Show don't tell。
  - Shorten：Half / Quarter / Single Paragraph。
  - "Tweak and Generate" 可以先调参数再生成；正文里写 `[方括号指令]` 也能当指令用。
- **Workshop Chat 消息栏**：
  - 上下文选择：全文或大纲（可按 POV）、幕/章/场景、片段、按类型或标签选 Codex。
  - 对话中途可以换提示词、换模型、调参数。
  - Retry；Extract from Chat 从对话里抽取节拍、Codex 条目、大纲。
  - 会话可命名、置顶、左右分屏、导出、归档、删除。
- **提示词库**：按类型分（节拍续写、摘要、文本替换、对话）。支持提示词组件和函数（如 `{context.storySoFar}`、`{context.codex}`）。发送前可以预览或修改输入。

**ChatGPT** [28][29]
- **编辑与分支**：编辑提问或重新生成都会产生新分支，用 ‹1/2› 箭头切换，用户消息和回答上都有。消息菜单 "⋯" 里有 "Branch in new chat"，从这条消息起另开一个会话。
- **Canvas**：
  - 可以选中文字后直接提问。
  - 快捷操作：Suggest edits；Adjust the length（从 Shortest 到 Longest 的滑杆）；Change reading level；Add final polish；Add emojis。
  - 版本：可前后翻版本，"Restore this version" 恢复；"Show changes" 把删除标红划线、新增标绿。
- **Projects**：项目里放文件和指令。

**Claude** [30]
- **编辑与重试**：编辑消息会产生分支，用箭头切换；Retry 带下拉选项。
- **Projects**：每个项目有 project knowledge 和 project instructions。
- **Styles**：内置 Normal / Learning / Concise / Explanatory / Formal，也可以用写作样本生成自定义风格，以输入框旁的 chip 形式按对话生效。
- **Artifacts**：有版本选择器；选中文字可用 "Edit with Claude"。

**Raycast AI** [31]
- **快捷键**：Enter 发送，Shift+Enter 换行；输入框为空时按 ↑ 编辑上一条；`⌘R` 重新生成；`⌘⇧B` 分支；`⌘F` 会话内查找。
- **编辑**：编辑任意一条消息后，从那里重新跑。
- **输入框**：`/` 打开模型选择器；`@` 调用扩展。附件可以是文件、笔记、剪贴板历史、浏览器标签、当前窗口、选中文本。
- **Presets 与 Memory**：Preset 是"模型 + 系统指令 + creativity + 工具"的组合；Memory 跨会话记住长期事实。
- **AI Commands**：
  - 内置：Improve Writing / Fix Spelling and Grammar / Explain This in Simple Terms / Change Tone to Professional / Change Tone to Friendly / Find Bugs in Code / Summarize Webpage / Ask About Webpage。
  - 占位符 `{selection}` `{clipboard}` `{argument}`。
  - 输出方式二选一：Open in Raycast 或 Replace Selection，可以开 "Highlight Editing Changes" 标出改动。
  - creativity 分 None 到 Maximum 五档，每条命令可单独绑定模型。

**Zed**（text threads，已移除）[32]
- 斜杠命令：`/default /diagnostics /fetch /file /now /prompt /symbols /tab /terminal /selection`。
- 执行结果以折叠文本插进线程，用户能直接看到并编辑发给模型的内容。
- 命令只在插入时求值一次。

**GitHub Copilot Chat（VS Code）**[33]
- **命令与变量**：
  - 斜杠：`/clear /explain /fix /fixTestFailure /help /new /tests`。
  - `#` 变量：`#file #selection #block #function #project` 等。
  - `@` 参与者：`@terminal @vscode @github`。
- **隐式上下文**：当前文件和选区自动以胶囊形式附上。
- **检查点**：每次请求前自动快照，可 Restore 再 Redo。编辑历史请求时，会自动回滚该请求及之后的所有改动，再重新发送。
- **会话**：可从任一请求 "Fork Conversation"；发送按钮下拉有 Queue / Steer / Stop。
- **其他**：👍👎 评分、时间戳、置顶提问、会话内搜索、完成后系统通知。

**Obsidian Copilot** [34]
- **自定义命令**：每条可设名称、提示词、可选模型，并可勾选是否出现在右键菜单、是否出现在 `/` 菜单。在对话里选一条 `/` 命令只会把模板插进输入框，不直接发送，用户可以先补充。
- **结果面板**：继续细化、复制、插入到光标处、替换选区。替换选区只在还能定位到原文时可用。
- **消息按钮**：插入或替换到光标处、复制、重新生成、删除。
- **上下文**：`@` 或 `[[笔记]]` 添加上下文；默认带上当前笔记，有选区时以选区优先。
- **@composer**：生成 diff，可 Accept / Reject / Revert。
- **其他**：Relevant Notes（相关笔记）；会话自动存成 Markdown，可搜索、重命名、删除。空状态提示语是 "Ask anything • @ to add context • / for commands"。

**Smart Connections / Smart Chat** [35]
- 不会自动把整个库发给模型，附加的上下文只对当前这次请求有效。
- 没挂上下文就发送时，会让用户四选一：Lookup context / Select context / Continue without context / Cancel。
- Context Builder 可以把"一篇锚点笔记 + 2–5 条辅助材料"存成可复用的上下文包。

**彩云小梦**（国内参照，第三方资料）[36]
- 每次续写给出 3 条故事走向，可以"换一批"。
- "后悔药故事线"可以回到任意一个续写节点。
- 续写字数可设，并可选结尾是否必须是完整句子。
- 内置文风：脑洞大开、细节狂魔、言情等。
- 世界设定支持人物词条和人物关系。

---

## 二、去重后的总清单（含有该功能的产品与优先级）

产品缩写：Cu=Cursor, No=Notion, NA=NovelAI, Su=Sudowrite, NC=Novelcrafter, GPT, Cl=Claude, Ra=Raycast, Ze=Zed, GH=Copilot, Ob=Obsidian Copilot, SC=Smart Chat, 彩=彩云小梦。"建议"表示主流产品里没有明确对应，是我针对中文场景加的。

### 输入区
| 功能 | 产品 | 优先级 | 理由（长篇中文小说） |
|---|---|---|---|
| Enter 发送 / Shift+Enter 换行，**输入法组字时（isComposing）不触发发送** | Ra, NA | P0 | 中文输入法用回车上屏，误发送是最先会被吐槽的问题 |
| 草稿持久化（切章节或关闭后不丢） | Ob, Cu | P0 | 长指令写到一半切去查设定，回来发现没了 |
| `/` 命令菜单（选中后插入模板，不直接发送） | Cu, GH, Ze, Ob, NC, Ra | P0 | 续写、扩写、润色是高频重复动作 |
| `@` 提及章节、人物、地点、大纲、伏笔、素材 | Cu, Su(#), NC, Ob, No, GH(#), Ra | P0 | 库里已经有这些实体表，直接复用 |
| 引用编辑器选区到对话（快捷键 + 引用块） | Cu, Ze, Su, Ob, GH | P0 | 讨论某一段是最常见的场景 |
| 提示词模板库（可编辑、带变量、可绑定模型） | NC, Ob, Ra, Cu, Su | P1 | 每个作者都有自己的"润色口诀" |
| 输入框实时显示字数和 token | Cu, NA | P1 | 已有的上下文预览要做到随打随更新 |
| ↑ 召回 / 编辑上一条 | Ra | P1 | 改一个词重新发很常见 |
| 正文内 `[方括号]` 或 `{花括号}` 指令 | NC, NA | P2 | 资深作者会用的高级技巧 |
| 生成中排队或插话 | Cu, GH | P2 | 主要对 ACP agent 有用 |
| 附件（txt/docx/参考文） | Ra, GPT, Cl, Ob | P2 | 导入参考稿、仿写样本 |

### 消息操作
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 复制（纯文本，去掉 Markdown 符号） | 全部 | P0 | 要粘贴到其他平台的后台 |
| 重新生成 | 全部 | P0 | 文学生成本来就要多抽几次 |
| 编辑并重发 | GPT, Cl, Ra, GH, Cu | P0 | 调整指令措辞 |
| 版本切换 ‹1/3›（重新生成不覆盖旧版） | GPT, Cl, NA, 彩 | P0 | 作者常要比较几版，NC 覆盖不可找回在社区被诟病 |
| 重试带选项（更长/更短/换风格） | Cl, No, Su | P1 | 省得重写一遍指令 |
| 从此处分叉为新会话 | GPT, Ra, GH, Cu | P1 | 同一章试两种走向 |
| 删除消息（同时移出上下文） | Ob | P1 | 跑偏的回答会污染后面的上下文 |
| 收藏或加星，存入灵感/素材库 | Su(star, Keepers), NC(Section) | P1 | 好句子先留着以后用 |
| 一键抽取为人物/地点/伏笔/大纲卡 | NC(Extract) | P1 | 和现有表打通，价值很高 |
| 👍👎 评分 | No, GH, GPT | P2 | 用于本地提示词调优 |
| 朗读 | GPT | P2 | 听稿查语感 |

### 输出采纳（当前只有"采纳到正文"）
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 插入到光标 / 替换选区 / 追加到章末（插入下方）三种方式 | No, Ob, Ra, Su, NC | P0 | 采纳只有一种方式时，改写类命令没法用 |
| 替换前 diff 预览（删除线和高亮） | Su(Quick Edit), GPT, Cu, Ob, Ra | P0 | 润色有没有改坏原意，作者要先看清楚 |
| 采纳后一步撤销，接入编辑器 undo 栈 | NA, Cu, NC | P0 | 采纳错了马上要能回退 |
| 采纳前自动清洗（去掉"好的，以下是……"开场白、Markdown 符号，统一全角标点和段首缩进） | 建议 | P0 | 中文网文排版规范很严 |
| 逐段接受或拒绝 | Cu, Ob | P1 | 长段润色时只想要其中几句 |
| 只采纳消息里的一部分（在消息中选中后采纳） | 建议 | P1 | 主流产品大多只能整条采纳，这是差异化点 |
| AI 文本标色，作者改过后褪色 | Su(紫色), NA | P1 | 方便定位需要二次改写的"AI 味"段落 |
| 章节检查点：恢复到采纳之前 | Cu, GH | P1 | 多次采纳之后整体回滚 |
| 另存为片段或新章节 | NC(Section), Su | P2 | 备选稿 |

### 会话管理
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 新建会话、历史列表 | 全部 | P0 | 基础功能 |
| 会话绑定到书/章节，切章时自动切换线程 | Su, Cl/Ob(Projects), NC | P0 | 上百章混在一个线程里根本没法用 |
| 自动标题、重命名 | NC, Cu, Ob | P1 | 方便找回 |
| 搜索会话 | Cu, Ob, Ra | P1 | 找"第 30 章那次关于反派的讨论" |
| 置顶、归档、删除 | NC, Ra | P1 | 日常整理 |
| 压缩或总结会话（`/summarize`） | Cu | P1 | 长讨论很快会超出上下文 |
| 导出 Markdown | NC, Cu, Ob | P2 | 备份 |
| 分屏或侧聊 | NC, Cu | P2 | — |

### 上下文
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 上下文胶囊：输入框上方显示本次注入的槽位，每个可点 × 去掉 | GH, Ob, NC, Cu | P0 | 已有的预览从"只能看"升级成"能改" |
| 槽位开关，当次覆盖 | NC, Su, SC | P0 | 比如头脑风暴时不想带入本章全文 |
| 设定自动注入：正文或指令里出现人物名、别名时注入对应人物卡 | NA, NC, Su | P0 | 长篇一致性的核心 |
| 前文范围：前 N 章原文或前情摘要 | Su(Continuity), NC(storySoFar) | P0 | 目前只注入"上章结尾"，不够用 |
| 对 AI 隐藏某张卡或某个字段（防剧透） | Su | P1 | 伏笔、真实身份这类信息 |
| 常驻记忆 + 近端强指令（Memory / Author's Note） | NA | P1 | "本卷基调"和"这段要虐"要分开放 |
| 预算条，超预算时按固定顺序裁剪 | NA, Su, Cu | P1 | 中文 token 消耗高，要知道裁掉了什么 |
| 上下文查看器显示"为何被包含" | NA | P1 | 排查"它为什么提到了 X" |
| 写作规则：全书常驻 / 按章 / 手动 | Cu, Cl, Su(Style) | P1 | 和已有的风格卡合并考虑 |
| 语义检索相关章节或素材 | Ob, SC | P2 | 一百万字以上时才明显需要 |
| 上下文包或预设 | SC, Ra | P2 | — |

### 生成控制
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 当前后端内快速换模型 | 全部 | P0 | 已有后端切换，但缺少模型级的选择 |
| 长度预设（300 / 800 / 2000 字，按中文字数计） | Su, NA, 彩, GPT | P0 | 作者按字数思考，不是按 token |
| 截断后"继续生成" | No, NA, NC | P0 | 长段落经常被截断 |
| 停止后保留已生成部分，可以直接采纳 | NC | P0 | 已有停止，要确认部分结果可采纳 |
| 出错时重试，错误分类：限流 / 余额 / 网络 / 上下文超长 | 建议 | P0 | API 用户最常遇到 |
| 一次出多个候选，卡片并排 | Su(1–6), 彩(3) | P1 | 选择比重写省力 |
| 温度或创造力档位 | Su, Ra, NA | P1 | 头脑风暴和润色适合的温度不同 |
| 文风预设快速切换 | 彩, Cl, Ra | P1 | 和风格卡联动 |
| "只聊不改" / "允许改稿" 模式 | Su, Cu | P1 | 和现有 ACP 权限卡统一 |
| Guided：AI 先给 3 条走向，选一条再写 | Su, 彩 | P1 | 很适合网文卡文时用 |
| AI 腔禁用词表 / 词语偏置（"嘴角勾起一抹弧度"之类） | NA(Phrase Bias) | P2 | 现有 bump_words 是灵感词，需要另建一张表 |
| 备选词 / token 概率 | NA | P2 | 小众功能 |

### 编辑器内联 AI
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 选区气泡菜单：润色、扩写、缩写、改写、换语气、描写 | No, Su, NC, Ob, Ra | P0 | 用户的肌肉记忆来自 Notion |
| 选区发送到对话（Cmd+L） | Cu | P0 | 打通编辑器和对话栏 |
| `Ctrl+K` 内联指令编辑，原文删除线对比 | Cu, Su | P1 | 小改动不必打开对话栏 |
| 光标处续写，结果用浮条 Apply / Retry / Discard | NC, NA, Su | P1 | — |
| 正文中间插写（参考前后文） | NA | P1 | 补过渡段 |
| 幽灵文本自动补全 | 建议（Copilot 式） | P2 | 小说里容易干扰思路，应默认关闭 |
| 单词近义词或成语替换 | Su(Related Words) | P2 | — |

### 体验
| 功能 | 产品 | 优先级 | 理由 |
|---|---|---|---|
| 区分"讨论"和"正文"两种渲染：讨论用 Markdown，正文按段落排版 | 建议 | P0 | 正文用 Markdown 渲染会乱 |
| 流式光标；用户往上翻时锁定滚动，并显示"跳到最新"按钮 | 通用 | P0 | 读长回复时页面一直跳会很烦 |
| 每条消息显示字数和 token | Cu, Ra | P1 | — |
| 空状态建议（如"续写本章 / 检查设定 / @ 添加人物"） | Ob | P1 | 帮新用户发现功能 |
| 停靠栏可展开、最大化、拖动高度 | No, NC | P1 | 底部栏太矮，读不了长文 |
| 快捷键速查 | Ra, Cu | P1 | — |
| 时间戳、会话内查找 | GH, Ra | P2 | — |
| 长任务完成后通知 | Ra, GH | P2 | — |
| Agent 工具调用折叠显示、本会话始终允许、Undo All | Cu, GH | P1 | 补全已有的权限卡 |

---

## 三、斜杠命令设计参考与中文小说命令集

### 各产品的实际命令
- **Cursor**：
  - IDE 内：`/summarize /create-rule /create-skill /migrate-to-skills`，外加自定义 `.cursor/commands/*.md`。
  - CLI：`/model /plan /ask /debug /goal /clear(=/new) /resume /fork /rewind /rename /summarize(=/compress) /mcp /shell /max-mode /logs /btw /side`。
- **GitHub Copilot**：`/clear /explain /fix /fixTestFailure /help /new /tests`，另有 `#selection` 等变量。
- **Zed**：`/default /diagnostics /fetch /file /now /prompt /symbols /tab /terminal /selection`。
- **Novelcrafter**：正文里的 `/` → Scene Beat、Continue Writing。
- **Obsidian Copilot**：全部是用户自定义命令，可以勾选"进 / 菜单"或"进右键菜单"。
- **Raycast**：输入框里的 `/` 用来选模型；命令名用自然语言，比如 "Improve Writing"、"Change Tone to Friendly"。

### 可以借鉴的设计
1. 选中命令后只插入模板，用户补完参数再发（Ob）。
2. 命令拉进来的上下文要看得见、改得了：Zed 用折叠文本，GH 用胶囊。
3. 每条命令可单独绑定模型和温度（Ra），也可以由用户自建（Cu 的 md 文件、Ob 的设置页）。
4. 每条命令声明默认输出方式：替换选区、插入光标、出卡片，或只在对话里显示（Ra 的 Replace Selection、Su 的卡片）。
5. 支持别名（Cu 的 `/clear=/new`）。中文命令应同时支持拼音首字母匹配，比如 `/xx` 匹配 `/续写`，省得频繁切输入法。

### 建议的中文小说命令集
"命中设定"指按人名、地名、别名自动注入 characters / places 条目，并沿用现有的风格卡槽位。

| 命令（别名） | 作用与参数 | 拉取的上下文 | 默认输出 |
|---|---|---|---|
| `/续写`（xx） | 从光标或章末续写；参数：字数、候选数 | 风格卡；上章结尾；本章光标前文本；光标在中间时也带光标后文本；本章大纲；命中设定 | 2–3 张候选卡，插入光标 |
| `/写场景`（xcj） | 用一句节拍写 500–1500 字 | 本章 outline 和 plot_blocks；节拍中点到的人物卡；前文末尾；计划在本章回收的伏笔 | 卡片，插入光标 |
| `/扩写`（kx） | 选区写长；参数：×1.5 / ×2 / ×3；侧重：细节、动作、心理 | 选区及前后各约 500 字；风格卡；命中设定 | diff 后替换 |
| `/缩写`（sx） | 参数：一半 / 四分之一 / 一段；去水 | 选区 | diff 后替换 |
| `/润色`（rs） | 语句通顺、去 AI 腔，不改情节 | 选区；风格卡；AI 腔禁用词表 | diff 后替换 |
| `/改写`（gx） | 参数：第一或第三人称；节奏快或慢；加内心戏；展示代替叙述；换基调 | 选区；POV 人物卡；风格卡 | diff 或候选卡 |
| `/对话`（dh） | 把叙述改成对白，或给指定人物写对白 | 选区；出场人物卡（性格、口头禅、说话方式）；character_relations | diff 或卡片 |
| `/描写`（ms） | 参数：五感 / 环境 / 外貌 / 打斗 / 氛围 | 光标附近文本；地点卡；人物外貌字段 | 每个维度一张卡（仿 Su 的 Describe） |
| `/心理`（xl） | 补 POV 人物的内心独白 | 选区；POV 人物卡（动机、秘密，遵守可见性设置） | 插入或替换 |
| `/头脑风暴`（tf） | 下一步走向、冲突、反转、爽点 | 本章；全书和本卷大纲；未回收伏笔；人物目标；可选随机 bump_words | 列表，👍 存入 ideas |
| `/起名`（qm） | 人名、地名、门派、功法、招式 | 世界观；已有名称（避免重复）；命名风格 | 列表，一键建卡 |
| `/标题`（bt） | 章节标题候选 | 本章全文 | 列表，可一键设为标题 |
| `/章末钩子`（gz） | 章末悬念 | 本章结尾；下章大纲 | 卡片，追加到章末 |
| `/总结本章`（zj） | 生成章节摘要 | 本章全文 | 写回章节摘要，供前情提要使用 |
| `/前情提要`（qq） | 前 N 章摘要 | 各章摘要 | 显示在对话里 |
| `/检查设定`（jc） | 找出和人物卡、地点、时间线、前文矛盾的地方 | 本章；命中设定卡；前 N 章摘要 | 冲突清单，可点击跳到原文 |
| `/伏笔`（fb） | 本章新埋了哪些伏笔、回收了哪些，以及建议的回收点 | foreshadows 表；本章 | 清单，确认后写回伏笔表 |
| `/提取设定`（tq） | 从本章或当前对话抽取新的人物、地点、物品 | 本章或当前会话 | 设定卡草稿，确认后入库 |
| `/审稿`（sg） | 点评节奏、钩子、水字数、视角混乱 | 本章；风格卡；书籍类型 | 批注列表 |
| `/灵感`（lg） | 用随机碰撞词出点子 | bump_words；本书大纲 | 存入 ideas |
| 会话类命令 | `/新会话` `/压缩` `/模型` `/风格` `/上下文`（显示预算明细） `/分叉` `/重命名` `/帮助` | — | — |

### 建议最先做的 10 项
1. 输入法组字时回车不发送
2. 三种采纳方式加 diff 预览
3. 采纳后可撤销
4. 重新生成时保留旧版本，用 ‹1/n› 切换
5. 会话按章节绑定
6. `/` 命令（含上表核心写作命令）
7. `@` 提及人物和设定
8. 上下文胶囊可开关
9. 人名命中时自动注入设定
10. 选区气泡菜单

---

## 来源
[1] https://cursor.com/docs/agent/overview
[2] https://cursor.com/docs/inline-edit/overview
[3] https://cursor.com/docs/context/rules
[4] https://cursor.com/docs/cli/reference/slash-commands
[5] https://cursor.com/changelog/1-6
[6] https://forum.cursor.com/t/what-happened-to-past-chats/143666
[7] https://cursor.com/changelog/05-06-26
[8] https://forum.cursor.com/t/per-change-keep-undo-buttons-missing-after-agent-edits-only-undo-all-available/158983
[9] https://www.notion.com/help/guides/notion-ai-for-docs
[10] https://www.notion.com/help/notion-ai-faqs
[11] https://www.notion.com/help/notion-agent
[12] https://allthings.how/how-to-use-notion-ai/ ；https://www.slashgear.com/1304573/notion-ai-note-taking/（第三方，旧版菜单）
[13] https://docs.novelai.net/en/text/editor/
[14] https://docs.novelai.net/en/text/lorebook/
[15] https://docs.novelai.net/en/text/editor/storysettings/
[16] https://docs.novelai.net/en/text/editor/advancedsettings/
[17] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/write/pvxUvbQqYybfEosqx1sXjY
[18] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/rewrite/9hkeezeUsCiUCG4dRdEqjS ；…/describe/aTHZdZBjRmH8AspqrPdPcP ；…/brainstorm/5xJUutV75BLU6u9LZndcDs
[19] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/selection-menu/of43eZdiHYoyCtrofDerCZ
[20] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/quick-tools/2asL35fds36oHAFJN7bYzz
[21] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chat/5vbuELXf6LZQnGfVzsEXCV
[22] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/saliency-engine/4KL8gFeLZNvk8CEeXpfwB2
[23] https://docs.sudowrite.com/using-sudowrite/1ow1qkGqof9rtcyGnrWUBS/chapter-continuity/4KL8gFeLZQ6GSBjDWtSbV6
[24] https://www.novelcrafter.com/help/docs/write/text-replacement-prompts
[25] https://www.novelcrafter.com/help/docs/chat/the-chat-interface ；https://www.novelcrafter.com/help/docs/chat/using-chat
[26] https://www.novelcrafter.com/help/docs/write/generating-prose
[27] https://www.novelcrafter.com/features ；https://www.novelcrafter.com/blog/may-2025-new-prompting-system-update ；https://www.novelcrafter.com/courses/codex-cookbook/codex-scenes
[28] https://openai.com/index/introducing-canvas/ ；https://help.openai.com/en/articles/9930697 ；https://zapier.com/blog/chatgpt-canvas/
[29] https://www.tomsguide.com/ai/chatgpt-just-quietly-rolled-out-a-game-changing-upgrade-heres-why-im-already-obsessed-with-it ；https://community.openai.com/t/chatgpt-web-update-removed-message-version-arrows-cannot-access-edited-message-history/1374666?page=2
[30] https://support.claude.com/en/articles/9519177-how-can-i-create-and-manage-projects ；https://support.anthropic.com/en/articles/9487310 ；https://www.ai-toolbox.co/claude-management-and-productivity/how-to-set-up-claude-custom-instructions-2026（第三方，Styles）
[31] https://manual.raycast.com/ai/ai-chat ；https://manual.raycast.com/ai/ai-commands ；https://manual.raycast.com/ai/quick-ai ；https://www.raycast.com/changelog/1-101-0 ；https://www.raycast.com/changelog/1-72-0
[32] https://zedhub.dev/ai/text-threads ；https://zed.dev/blog/zed-ai ；https://github.com/zed-industries/zed/issues/53760
[33] https://docs.github.com/en/copilot/reference/cheat-sheet ；https://code.visualstudio.com/docs/copilot/chat/copilot-chat ；https://code.visualstudio.com/docs/copilot/chat/chat-checkpoints
[34] https://docs.obsidiancopilot.com/custom-prompts ；https://docs.obsidiancopilot.com/chat-interface/ ；https://www.obsidiancopilot.com/en/docs/composer ；https://www.obsidiancopilot.com/en/docs/chat-mode
[35] https://smartconnections.app/smart-chat/faq/ ；https://smartconnections.app/smart-context/builder/
[36] https://ai-bot.cn/sites/913.html ；https://sj.qq.com/appdetail/com.dreamilyai.app（第三方）
