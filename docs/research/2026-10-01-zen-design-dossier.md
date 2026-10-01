# Zen Browser 设计档案（写作软件迁移用）

> 调研日期 2026-10-01；上游 zen-browser/desktop dev 分支。

# Zen Browser 设计档案：给长篇写作应用的数值参考

**来源说明**
- 本地文件：`D:/playground/help3/shuilai/docs/zen-ref/` 下的 10 个 CSS 文件全部读过。
- 上游文件：从 `zen-browser/desktop` 的 dev 分支抓取（2026-10-01），共约 30 个，涵盖 `src/zen/**`、`prefs/zen/*.yaml` 和若干 Firefox CSS patch。临时副本放在 `E:/Temp/claude/D--playground-help3-shuilai/d1f90bef-18ae-4eab-821e-e3f9a3ab3c30/scratchpad/zen/`。
- 另外看了官网、release notes 和几篇评测。没有修改任何项目文件。
- 下文提到的 `docs/zen-ref/...` 都在上述本地目录里，`src/zen/...` 和 `prefs/...` 是上游仓库路径。

---

## 1. 布局：背景板上浮一张内容卡片

**层级结构**
- 窗口根 `#zen-main-app-wrapper` 本身就是背景。它下面有一层 `.zen-browser-generic-background`，`::before` 放上一个主题、`::after` 放当前主题，两层靠 `--zen-background-opacity` 做淡入淡出（`src/zen/common/styles/zen-browser-ui.css`）。
- 侧栏 `#navigator-toolbox` 和工具栏的背景都是 `transparent`，标签直接画在背景上。
- 只有网页内容被做成卡片。

**关键数值**

| 项 | 值 | 出处 |
|---|---|---|
| 元素间距 `--zen-element-separation` | 默认 **8px**，上限 12px；设为 0 时取 0.1px 并加上 `zen-no-padding` 属性 | `prefs/zen/theme.yaml`、`zenThemeModifier.js` |
| 内容区外边距 | `#zen-tabbox-wrapper { margin: sep; margin-top:0; }`，靠侧栏那一侧也是 0，即只有三边留白 | `zen-browser-ui.css` |
| 分屏间隙 | `#tabbrowser-tabbox { gap: sep }` | 同上 |
| 窗口圆角 `--zen-border-radius` | macOS 10px（Tahoe 11px），Windows 9px，Linux 取 GTK 值或 8px | `zenThemeModifier.js` |
| 内圆角 | `--zen-native-inner-radius: max(5px, (R - sep/2) * squircle)`，卡片实际用 `inner / squircle` | `docs/zen-ref/src_zen_common_styles_zen-theme.css` L279 |
| 内容卡片 | `box-shadow: var(--zen-big-shadow)` = **`rgba(0,0,0,.24) 0 3px 8px`**；背景浅色 `#fff`、深色 `rgb(32,32,32)`；`overflow: clip` | `zen-browser-container.css` |
| 默认背景色 | 浅色 `rgb(235,235,235)`、深色 `#1b1b1b`；渐变生成器的回退色为 `#e9e9e9` / `#131313` | `zen-theme.css`、`ZenGradientGenerator.mjs` |
| squircle 系数 | macOS 1.3，Windows 2.3；只在支持时启用 `corner-shape: superellipse(var(--zen-squircle-value))` | `zen-theme.css` L220/L358 |

内圆角公式的含义是"同心圆角"：内层圆角 ≈ 外层圆角 − 间距/2。以 Windows 为例，(9 − 4) × 2.3 ÷ 2.3 = **5px**；macOS 约为 **6px**。卡片圆角并不大，柔和感主要来自"同心"和 squircle 曲线。

**侧栏和背景之间没有硬边界**
- `#navigator-toolbox { border:none }`，侧栏没有任何描边。
- 拖拽分隔条 `#zen-sidebar-splitter` 平时 `opacity:0`，只占 `--zen-toolbox-padding` 宽（5–6px）。hover 并延迟 **0.2s** 后显示为 accent 色，`opacity .8`，圆角 4px（`zen-browser-ui.css` L302）。
- 侧栏与卡片之间只靠 8px 留白加卡片阴影来区分。
- 侧边栏里的书签面板 `#sidebar-box` 是另一张卡片：内圆角加 big-shadow（`docs/zen-ref/src_zen_common_styles_zen-sidebar.css`）。

**尺寸**（`docs/zen-ref/src_zen_tabs_zen-tabs_vertical-tabs.css`）
- 折叠侧栏：`--tab-min-width: 48px`，`--zen-toolbox-padding: 6px`，总宽 **60px**。
- 展开侧栏：最小宽 150px，可拖到 500px（`zen.view.sidebar-expanded.max-width`）。
- 工具栏高 38px（macOS 42px）；单工具栏模式 36px / 38px。

**紧凑模式**（`src/zen/compact-mode/sidebar.inc.css`、`prefs/zen/compact-mode.yaml`）
- 侧栏变成 `position:fixed` 的浮动面板，靠 `translate: -(sidebarWidth + 8px - 1px)` 移出屏幕。
- 隐藏动画：`translate .15s ease`。
- 呼出动画：`--zen-compact-mode-time: .25s`，曲线是 `linear()` 采样出的弹簧，大约在 72% 处冲到 **1.0109**（约 1% 过冲），最后落在 1.0034。
- 浮动面板背景 `.zen-toolbar-background`：
  - 浅色 `#e9e9e9`、深色 `#131313`，加 big-shadow。
  - 用 `outline: 1px solid rgba(255,255,255,.15); outline-offset:-1px` 做内高光细线。
  - `background-attachment: fixed; background-size: 100vw 100vh`，让面板里的渐变和窗口背景对齐、连成一片。
  - 开启亚克力效果时加 `backdrop-filter: blur(42px) saturate(110%) brightness(.25)`。
- 时序参数：

| 参数 | 值 |
|---|---|
| 离开侧栏后保持显示 | 150ms |
| 顶栏离开后隐藏 | 1000ms |
| 闪现提示 | 800ms |
| 边缘触发距离 | 10px（`_getCrossedEdge maxDistance=10`） |
| 鼠标出窗口的容差 | 水平 200px / 垂直 100px |
| 切换紧凑模式本身 | Motion 弹簧，`bounce:0`，`duration:.09s` |

- 顶栏在紧凑模式下高度收到只剩一个 sep，内容 `opacity` 过渡用 `--zen-hidden-toolbar-transition: .15s ease-in-out`。

---

## 2. 颜色系统

**工作区渐变**（`src/zen/spaces/ZenGradientGenerator.mjs`）
- 色轮上最多放 3 个点，配色规则有 complementary [180]、splitComplementary [150,210]、analogous [50,310]、triadic [120,240]、floating。
- 1 色：纯色。
- 2 色：`linear-gradient(-30deg, c2 30%, transparent 120%), linear-gradient(150deg, c1 30%, transparent 120%)` 两层叠加。
- 3 色：`linear-gradient(-5deg, c1 10%, transparent 80%)`，加 `radial-gradient(circle at 95% 0%, c3 0%, transparent 75%)`，再加 `radial-gradient(circle at 0% 0%, c2 10%, transparent 70%)`。
- 默认 opacity 为 **0.5**。不支持窗口透明的平台会按 opacity × 100% 把颜色和基底混合：浅色基底 `[240,240,244]`，深色基底 `[23,23,26]`。所以背景是一层淡淡的染色，不会是高饱和纯色。
- 颗粒纹理：`grain-bg.png` 平铺，`opacity = texture`（0–1，色盘上 16 档，默认 0），过渡 `opacity .2s`（`zen-browser-ui.css` L87）。

**文字和图标的对比度**
- `shouldBeDarkMode()` 分别把 `rgba(0,0,0,.9)` 和 `rgba(255,255,255,.9)` 合成到背景上，按 WCAG 公式算对比度，取更高的一方。透明平台上白字的 alpha 会再减去 `dark-mode-bias = 0.3`。
- `--toolbox-textcolor` = 90% 黑或白，再混入主色 5%（不透明平台）或 20%（透明平台）。文字因此带一点主题色，不是纯中性色。

**alpha 叠加层**（都用 `currentColor` 或反相品牌色混合，不写死颜色）

| 用途 | 值 |
|---|---|
| hover 填充 | `color-mix(--zen-branding-bg-reverse 7%, transparent)` |
| active 填充 | 同上 10% |
| 元素底色 `--zen-toolbar-element-bg` | oklch 中 textcolor 8%（浅）/ 15%（深） |
| 关闭按钮 hover / active | `currentColor` 10% / 20% |
| 次要按钮 | `currentColor` 10%，hover 15% |

**选中标签**（`src/zen/spaces/zen-workspaces.css` L337）
- 浅色：`color-mix(rgba(255,255,255,.8) 98%, primary)`；深色：`color-mix(rgba(255,255,255,.18) 95%, primary)`。
- 阴影 `0 .8px 1.5px 0 rgba(0,0,0,.15)`（深色 .05），是一块非常薄的"纸片"。
- 圆角 `--border-radius-medium: 14px`，配合 superellipse 显示，看起来约 7–8px。

**分隔线**
- 置顶区分隔线：1px `rgba(0,0,0,.1)` / `rgba(255,255,255,.1)`，左右缩进 4px。
- 滚动区上下边缘的细线 `.08`，只在"未滚到顶/底"时显示（`[overflowing]:not([scrolledtostart])::before`）。
- 面板分隔线：`currentColor 15%`。
- 分屏标签组内部竖线：1×16px，`.1` / `.2`。

**accent 的用法**
- 只用在少数地方：splitter、拖放指示线（`primary 50%` 混黑/白 50%，2px 线加圆头）、toast、命令栏选中行（primary 50% 混 `rgba(0,0,0,.5)`，文字白色）。
- 对话框主按钮反而是单色：`#1c1c1c` / `#dddddd`（`zen-buttons.css`）。

---

## 3. 字体与密度

**字体**
- Windows 用 `'Segoe UI'`，macOS 用 SF Pro。
- 标签字号 14px（Windows）/ 1.25rem（macOS）。
- 地址栏结果标题 14px / 500，URL 用 `#4f4f4f` / `#aaa`。
- 按钮字重 500，toast 14px / 600，工作区名 small / 600。
- 副标签 `x-small`、`opacity .5`。
- 品牌标题用衬线体 Junicode，`6rem`、`line-height .9`，开启 `swsh` 花饰字形（`zen-branding.css`）。

**标签行**
- `--tab-min-height` 36px，加上 `--tab-margin-block` 2px，行距 **40px**。
- 内边距 8px，图标后间距 8.5px，图标 16px。

**工具栏按钮**
- 图标 16px（macOS 17px），内边距 6px，点击区 28px，圆角 6px。

**Essentials 网格**
- `grid-template-columns: repeat(auto-fit, minmax(max(23.7%, 50px), 1fr))`，gap 4px，格子高 46px。

**菜单**（`zen-popup.css`）
- 菜单项圆角 5px，内边距 8px / 14px，外边距 2px / 4px。
- 面板圆角 10px（macOS Tahoe 12px）。
- 面板背景 `rgb(244,244,244)` / `rgb(31,31,31)`。

**"安静界面"的做法**：次要控件默认隐藏，hover 时才出现。
- 关闭按钮：`:not(:hover){display:none}`。
- 工作区操作按钮、URL 栏页面动作：`opacity 0 → 1`，过渡 0.15s，触发条件是 `[zen-has-implicit-hover]`。
- 非活动工作区图标：`grayscale(1) opacity .7`。
- 新标签按钮文字：70% 透明度。

---

## 4. 动效（JS 动画用内置的 Motion 库 `src/zen/vendor/motion.min.mjs`，参数是 `{type:"spring", bounce, duration}`）

| 动作 | 参数 | 出处 |
|---|---|---|
| 按下标签 | `scale .985`（`--zen-active-tab-scale`），`transition: scale .1s ease`，加 `rotate .01deg` 触发 GPU；按下图标 `.97` | vertical-tabs.css L339 |
| 新开标签 | opacity 0→1，scale .95→1，`.12s easeOut`；标题 `blur(1px)→0` `.1s`；下方的项 `translateY(-h→0)` 120ms ease-out | ZenUIManager.mjs ~L1099 |
| 关闭标签 | opacity →0，scale →.95，`marginBottom →-h`，`.1s easeOut` | 同上 L1166 |
| 缩进变化 | `margin-inline-start .1s ease-in-out`；文件夹每层缩进 14px | zen-theme.css、zen-folders.css |
| 切换工作区 | 每个空间 `translateX(±100%)`，弹簧 `bounce 0`，`.25s`；背景同步淡入淡出；手势滑动带橡皮筋阻尼 `1-|x|/(w*4.5)` | ZenSpaceManager.mjs L2131、ZenSpacesSwipe.mjs |
| 紧凑模式 | 呼出 .25s 过冲弹簧，隐藏 .15s ease | §1 |
| Glance 打开 | 350ms，80 帧沿**弧线**移动（弧高 = 距离 × 0.2，最多 20px）；打开用 easeOutBack（c1=.4，轻微回弹），关闭用 `1-(1-t)^6`；原页面卡片 scale→**.97**、opacity→**.3**，弹簧 bounce .2；侧边按钮 .2s 延迟淡入；"展开为完整标签"时 scale `[1,1.005,1]` 250ms | ZenGlanceManager.mjs |
| Toast | 进入：scale 0→1，弹簧 bounce **.2**，.5s；2000ms 后消失（hover 时暂停）；退出：opacity→0、scale→.5，.2s | ZenUIManager.mjs L784 |
| 对话框 | `zen-dialog-fade-in .3s ease-out`，从 `translateY(-10px)`、opacity 0 开始 | zen-animations.css、dialog.css |
| 命令栏 | 打开 `urlbar-grow`：scaleX .99 / scaleY .98 →1，150ms；切换搜索模式 scale `[1,.98,1]` .25s；光晕 `box-shadow 0 0 20px → 250px transparent`，1s | urlbar-css.patch、zen-animations.css |
| 按钮 | 按下 `scale(.98)`，.1s；大号强调按钮 hover `scale 1.03` 加 `brightness(1.1)`，.15s ease-out | zen-buttons.css |
| 分屏 | 布局变化 `inset .09s ease-out`；放下时 scale .97→1，弹簧 bounce **.4**，.2s，延迟 .1s；顶部控制条 .1s 延迟出现 | zen-split-view.css、ZenViewSplitter.mjs |
| 其他 | 重命名完成 scale `[1,.98,1]` .25s；输入错误时抖动 x `[0,-12,8,-4,2,0]` 600ms；"+" 按钮旋转 45° .2s | ZenUIManager.mjs |

所有动画都受 `prefers-reduced-motion` 和 `gReduceMotion` 控制。

---

## 5. 值得借鉴的交互

1. **工作区**：每个空间有自己的渐变、图标和主色，切换时整个窗口换色并横向滑动。
2. **Essentials**：常用项做成图标网格；选中项是一块内缩 2px 的 `rgba(255,255,255,.85)` 底板，背后放一层模糊的 favicon 光晕（`::after inset:-50% blur(20px)`）。
3. **分屏**：
   - 最多 4 格；把标签拖到内容区边缘停 500ms 触发分屏（阈值 40px）。
   - 当前格加 2px 描边；顶部居中有一个只在 hover 时出现的"下沉式"控制条（只有下方两个角 6px 圆角）。
   - 拖拽时的预览框：2px primary 边，`rgba(255,255,255,.1)` 填充；拖拽图 200×250，圆角 16px。
4. **Glance**：Alt+点击链接，打开一个 80% 宽的预览层，背景卡片缩小变暗；右侧有一列 999px 圆形按钮（关闭、展开、分屏）；关闭需要二次确认，确认态变红并展开文字。
5. **浮动命令栏**：
   - 位置：宽 `min(innerWidth/1.5, 750px)`，垂直居中偏上（`top = h/2 - max(333, h_bar)/2`）。
   - 外观：高 62px，圆角 14px；阴影 `0 30px 140px -15px rgba(0,0,0,.8)`（深色 .6）；0.5px 描边 `rgba(0,0,0,.2)` / `rgba(255,255,255,.1)`。
   - 结果列表：最多 252px 高，隐藏滚动条；行内边距 10 / 8px；未选中行文字 70% 透明度。
   - 快捷键提示是大写 10px 的小胶囊，带 1px 环线。
6. **文件夹**：最多 5 层，每层缩进 14px。
7. **Toast**：
   - 位置在右上角，距边 `max(4px, sep)`；高 42px，圆角 14px。
   - 背景是主色竖向渐变 `primary -40% → primary 混 #0f0f0f 20%`。
   - 内嵌按钮圆角 10px，顶部有一条 2px 高光边。
8. **对话框**（`zen-panels/dialog.css`）：
   - 圆角 `12px × squircle`；边框 0.5px `rgba(0,0,0,.4)`，深色模式加 1px `rgba(168,168,169,.5)` 内描边，偏移 −2px。
   - 阴影 `0 10px 8px rgba(0,0,0,.15)`。
   - macOS 上在按钮里标出 ⏎ / ESC 提示。
9. **拖放指示线**：2px 线，起点带一个空心圆头。

---

## 6. 它为什么比一般 Electron/Tailwind 应用显得高级（分析）

1. **只有一个视觉焦点**：全窗口唯一不透明、带阴影的块就是内容卡片，其余界面都"贴"在背景上。
2. **几乎没有描边**：层次靠 8px 留白、一档阴影和 alpha 叠加来区分，不靠 border。
3. **叠加层都从 `currentColor` 或反相色算出来**，所以 hover、选中这些状态在任何主题色下都自然。一般应用会写死灰色。
4. **同心圆角加 squircle**：内层圆角 = 外层 − 间距/2，曲率是连续的。
5. **背景有颜色但不抢眼**：渐变先按 opacity 0.5 和中性基底混合，再加可选的颗粒纹理，读起来像纸面的质感，不像霓虹。
6. **文字颜色跟着主题走**：主色混入 5–20%，对比度用算法判断，不是简单的黑或白。
7. **动效短而轻**：大多数在 .1–.25s，常用操作几乎没有过冲；只在 toast、Glance、放下分屏这类低频、值得一点惊喜的地方用 bounce .2–.4。
8. **界面安静**：次要控件等 hover 才出现，非活动元素去色、降透明度。
9. **数值是体系化的**：一个 sep、一个 R、一组 alpha 阶梯（7 / 8 / 10 / 15 / 20%），全部从 CSS 变量派生。

---

## 7. 映射到写作应用

| Zen 特征 | 写作应用里的对应 | 建议值 |
|---|---|---|
| 背景板 + 卡片 | 窗口背景（按作品/书着色），中央 TipTap 编辑器是唯一主卡片 | `--app-sep: 8px`；卡片 `margin: 0 8px 8px 0`（靠 Ribbon 那侧为 0）；圆角 `max(5px, R - sep/2)`，R 取 9–10px；`box-shadow: 0 3px 8px rgba(0,0,0,.24)`；纸面 `#fff` / `rgb(32,32,32)` |
| 透明侧栏 | Ribbon 和章节树直接放在背景上，去掉所有 border-right | 拖拽分隔条平时透明，hover 延迟 .2s 后显示 4px 宽的 accent 条，opacity .8 |
| 第二张卡片（`#sidebar-box`） | 右侧 dock 做成独立卡片，和编辑器之间留 8px | 同样的圆角和阴影；dock 内标签页参照 essentials 的选中底板 |
| 底部 AI 聊天 dock | 编辑器列里纵向堆叠的第二张卡片，间距 8px；也可以按 Glance 的方式做成浮层 | 浮层用命令栏参数：圆角 14px，0.5px 描边，阴影 `0 30px 140px -15px` |
| 标签行 | 章节树的节点 | 行高 32–36px，行距 +2px；选中用 `rgba(255,255,255,.8)` 混 2% 主色，阴影 `0 .8px 1.5px rgba(0,0,0,.15)`；hover 7% 填充；缩进 14px/层，带 .1s 过渡；"更多"按钮只在 hover 时出现 |
| 折叠侧栏 / 工作区图标 | Ribbon | 48px 的按钮放在 60px 宽的栏里；非活动 `grayscale(1) opacity .7`，活动态恢复，过渡 .2s；按钮约 30px，圆角 6px |
| 工作区 | 作品或卷，每个配一组渐变 | 横向滑动 .25s 弹簧 bounce 0，背景同步淡入淡出 |
| 紧凑模式 | 「专注 / 禅模式」：隐藏 Ribbon、树和两个 dock，只剩稿纸 | 左边缘 10px 内触发；离开后保持 150ms；呼出 .25s 带约 1% 过冲，隐藏 .15s ease；浮动面板用 `background-attachment: fixed` 和背景对齐 |
| 浮动地址栏 | 命令面板（Ctrl+K） | 宽 `min(66vw, 750px)`；选中行 primary 50%、白字；快捷键胶囊 10px 大写 |
| Glance | 预览引用的章节或设定卡片而不离开当前稿 | 背景卡片缩到 .97、变暗到 .3；预览 80% 宽；时长可降到 250ms |
| Toast | 「已保存」「已生成」这类提示 | 右上角，高 42px，圆角 14px，2s 后消失、hover 暂停；进入用弹簧 bounce .2 |
| 对话框 | 设置、确认类模态框 | 圆角约 12px，0.5px 边，`0 10px 8px rgba(0,0,0,.15)`，`translateY(-10px)` 进入 .3s；主按钮用单色 |
| 拖放 | 章节排序 | 2px 指示线加圆头，颜色 primary 50% |

**建议不要照搬的部分**
1. **颗粒纹理和高饱和渐变不要出现在稿纸卡片里**，只能放在背景上，opacity 不超过 0.3–0.5。长时间阅读时噪点和色偏会造成疲劳。
2. **正文不要用 70% 透明度的文字**。Zen 的命令栏结果用 70% 透明度做弱化，正文应保持接近 90% 或更高的对比度。中文笔画密，低对比更伤眼。
3. **紧凑模式的自动隐藏不应作为默认**，只在用户主动进入专注模式时启用。写作中鼠标经常靠近左边缘，会误触发。
4. **过冲弹簧和 Glance 弧线不要用在高频操作上**，比如逐章切换、保存、打字反馈，这些应该零过冲且不超过 120ms。bounce 只留给 toast、拖放落位这类低频事件。
5. **按压缩放（.985）不要用在编辑器或大面积卡片上**，只用于树节点和按钮。
6. **慎用 `backdrop-filter: blur(42px)`**。Tauri 在 Windows 上走 WebView2，大面积实时模糊性能差，建议换成不透明的 `#e9e9e9` / `#131313` 加内高光细线，或者只给浮层用。
7. **14px 的 superellipse 圆角不要直接搬**。WebView 没有 `corner-shape` 时会渲染成 14px 圆形，显得像胶囊。树节点用 6–8px 就够。
8. **Essentials 的 favicon 光晕和主题色染文字**在写作场景没有意义，或者会降低可读性：编辑器里的文字保持中性色，只让外围界面带主题色。

**可以直接沿用的 token 草案**
- `--sep: 8px`
- `--r-outer: 10px`
- `--r-card: max(5px, calc(var(--r-outer) - var(--sep) / 2))`
- `--shadow-card: 0 3px 8px rgba(0,0,0,.24)`
- `--fill-hover: color-mix(in srgb, var(--fg) 7%, transparent)`
- `--fill-active: 10%`（同上写法）
- `--fill-element: 8%`（深色 15%）
- `--sel-bg: color-mix(in srgb, rgba(255,255,255,.8) 98%, var(--accent))`
- `--sel-shadow: 0 .8px 1.5px rgba(0,0,0,.15)`
- `--hairline: color-mix(in srgb, currentColor 10–15%, transparent)`
- `--dur-fast: .1s`
- `--dur-ui: .15s`
- `--dur-space: .25s`
- `--ease-reveal`：用 Zen 的 `linear()` 采样曲线，或 Motion 的 `spring bounce 0`

**参考来源**
- [zen-browser.app](https://zen-browser.app/)
- [Release notes](https://zen-browser.app/release-notes/)
- 评测：[razvanvancea.ro](https://razvanvancea.ro/blog/2025/09/19/zen-browser-review-the-calmer-side-of-internet/)、[flavienbonvin.com](https://flavienbonvin.com/articles/how-to-make-zen-browser-feel-like-arc/)、[TechPP](https://techpp.com/2026/01/30/zen-browser-review/)

Release notes 中和设计相关的条目：
- v1.22b：全局改用 squircle，侧栏和命令栏加入模糊效果。
- v1.16.4b / v1.17b：紧凑模式改为浮层，覆盖在内容上方。
- v1.15.4b：标签开合动画加快。
- v1.19.9b：Glance 的"浮起"动画改进。

评测普遍认为 Zen 的核心卖点是设计，其中紧凑模式、工作区和渐变主题提到最多。
