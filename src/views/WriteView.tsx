import { useMemo } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "../components/layout/Sidebar";
import { EditorPane } from "../components/editor/EditorPane";
import { PanelDock } from "../components/layout/PanelDock";
import { loadDockPct, loadSidebarPct, saveDockPct, saveSidebarPct, useUiNav } from "../lib/nav/uiStore";

// 写作视图：三栏（侧栏/编辑器/右侧 dock）。原 AppShell 的 Group 迁入于此。
// react-resizable-panels v4 用法约束（实测得出，必须保留）：
// 1. 显式 defaultLayout（面板 id → 百分比）+ Panel 显式 id；
// 2. 尺寸用无单位字符串（=百分比），不用像素约束；命令式 resize() 的裸数字
//    会被 v4 当成 px（"20"=20px），必须传 "20%"；
// 3. **不要用任何命令式折叠 API**。v4.12.4 实测（CDP 直连真机验证）：panel 级
//    collapse()/resize()/isCollapsed() 与 group 级 setLayout() 在本布局下全部
//    静默无效（无报错、onLayoutChange 不触发），疑似组注册态 defaultLayoutDeferred
//    未解除。折叠一律 CSS 摘除：Group 根挂 data-*-collapsed 属性 + styles.css
//    display:none 规则，面板内联 flexGrow 保持原值、展开即还原拖定宽度；
// 4. 库只负责展开态的拖拽调宽与 onResize 记忆；折叠态 Separator 不渲染，
//    天然无拖拽冲突。
const SIDEBAR_MIN = 14;
const SIDEBAR_MAX = 28;
const DOCK_MIN = 17;
const DOCK_MAX = 34;
/** 无记忆时的恢复宽度：sidebar 默认 20 时 rest*0.3 = 24 */
const DOCK_DEFAULT_PCT = 24;

function clampSidebarPct(pct: number | null): number {
  if (pct == null) return 20;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, pct));
}

function clampDockPct(pct: number | null): number {
  if (pct == null) return DOCK_DEFAULT_PCT;
  return Math.min(DOCK_MAX, Math.max(DOCK_MIN, pct));
}

export function WriteView() {
  const collapsed = useUiNav((s) => s.sidebarCollapsed);
  const dockCollapsed = useUiNav((s) => s.dockCollapsed);

  // 初始布局：恢复用户上次拖定的侧栏/dock 宽度，editor 吃剩余
  const initialLayout = useMemo(() => {
    const sidebar = clampSidebarPct(loadSidebarPct());
    const dock = clampDockPct(loadDockPct());
    return { sidebar, editor: 100 - sidebar - dock, dock };
  }, []);

  return (
    // 属性挂在自己的包裹层上——v4 Group 不保证转发 data-* props（其根节点只渲染
    // 自有属性），折叠开关必须由我们完全掌控的 DOM 承载
    <div
      className="h-full"
      data-sidebar-collapsed={collapsed ? "" : undefined}
      data-dock-collapsed={dockCollapsed ? "" : undefined}
    >
      <Group
        orientation="horizontal"
        className="h-full bg-[var(--bg-base)]"
        defaultLayout={initialLayout}
      >
      <Panel
        id="sidebar"
        defaultSize={String(initialLayout.sidebar)}
        minSize={String(SIDEBAR_MIN)}
        maxSize={String(SIDEBAR_MAX)}
        onResize={(size, _id, prev) => {
          if (prev === undefined) return; // 首帧不记忆
          const pct = size.asPercentage;
          if (pct <= 1) {
            // 拖过 minSize 被吸附折叠：单向同步 store（宽度 0 不记忆）
            if (!useUiNav.getState().sidebarCollapsed) {
              useUiNav.setState({ sidebarCollapsed: true });
            }
            return;
          }
          // 从折叠拖出：单向同步 store 为展开
          if (useUiNav.getState().sidebarCollapsed) {
            useUiNav.setState({ sidebarCollapsed: false });
          }
          saveSidebarPct(pct);
        }}
        className={`panel-sidebar${collapsed ? "" : " border-r border-[color:var(--border-subtle)]"}`}
      >
        {!collapsed && <Sidebar />}
      </Panel>
      {!collapsed && (
        <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      )}
      <Panel id="editor" defaultSize={String(initialLayout.editor)} minSize="30">
        <EditorPane />
      </Panel>
      {!dockCollapsed && (
        <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      )}
      <Panel
        id="dock"
        defaultSize={String(initialLayout.dock)}
        minSize={String(DOCK_MIN)}
        maxSize={String(DOCK_MAX)}
        onResize={(size, _id, prev) => {
          if (prev === undefined) return; // 首帧不记忆
          const pct = size.asPercentage;
          if (pct <= 1) {
            if (!useUiNav.getState().dockCollapsed) {
              useUiNav.setState({ dockCollapsed: true });
            }
            return;
          }
          if (useUiNav.getState().dockCollapsed) {
            useUiNav.setState({ dockCollapsed: false });
          }
          saveDockPct(pct);
        }}
        className={`panel-dock${dockCollapsed ? "" : " border-l border-[color:var(--border-subtle)]"}`}
      >
        {!dockCollapsed && <PanelDock />}
      </Panel>
      </Group>
    </div>
  );
}
