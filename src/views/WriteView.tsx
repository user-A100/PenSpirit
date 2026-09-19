import { useCallback, useEffect, useMemo, useRef } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { Sidebar } from "../components/layout/Sidebar";
import { EditorPane } from "../components/editor/EditorPane";
import { PanelDock } from "../components/layout/PanelDock";
import { loadSidebarPct, saveSidebarPct, useUiNav } from "../lib/nav/uiStore";

// 写作视图：三栏（侧栏/编辑器/右侧 dock）。原 AppShell 的 Group 迁入于此。
// react-resizable-panels v4 用法约束（实测得出，必须保留）：
// 1. 显式 defaultLayout（面板 id → 百分比）+ Panel 显式 id；
// 2. 尺寸用无单位字符串（=百分比），不用像素约束；
// 3. 侧栏折叠走 Panel 原生 collapsible + collapsedSize="0"，
//    命令式 collapse()/resize() 由 uiStore.sidebarCollapsed 驱动；
//    折叠补间用 data-rail-animating 手法（styles.css 过渡 flex-grow 200ms），
//    勿硬改 defaultLayout——折叠态布局归一化由库处理。
const SIDEBAR_MIN = 14;
const SIDEBAR_MAX = 28;
const ANIM_MS = 200;

function clampSidebarPct(pct: number | null): number {
  if (pct == null) return 20;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, pct));
}

export function WriteView() {
  const collapsed = useUiNav((s) => s.sidebarCollapsed);
  // WriteView 常挂保状态，但只在可见时同步面板命令式状态（display:none 下测量不可靠）
  const viewActive = useUiNav((s) => s.activeView === "write");
  const sidebarRef = usePanelRef();
  const groupElRef = useRef<HTMLDivElement | null>(null);
  const animTimer = useRef<number | undefined>(undefined);

  // 初始布局：恢复用户上次拖定的侧栏宽度，editor:dock 保持 7:3
  const initialLayout = useMemo(() => {
    const sidebar = clampSidebarPct(loadSidebarPct());
    const rest = 100 - sidebar;
    return { sidebar, editor: rest * 0.7, dock: rest * 0.3 };
  }, []);

  // 折叠/展开补间：动画期间给 Group 根节点挂 data-rail-animating，200ms 后移除
  const animateRail = useCallback(() => {
    const el = groupElRef.current;
    if (!el) return;
    el.setAttribute("data-rail-animating", "");
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => {
      el.removeAttribute("data-rail-animating");
    }, ANIM_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  // 命令式折叠/展开（含隐藏期间切过状态、回到本视图时的补同步）
  useEffect(() => {
    if (!viewActive) return;
    const panel = sidebarRef.current;
    if (!panel || panel.isCollapsed() === collapsed) return;
    animateRail();
    if (collapsed) panel.collapse();
    else panel.resize(clampSidebarPct(loadSidebarPct()));
  }, [collapsed, viewActive, animateRail, sidebarRef]);

  return (
    <Group
      orientation="horizontal"
      className="h-full bg-[var(--bg-base)]"
      defaultLayout={initialLayout}
      elementRef={groupElRef}
    >
      <Panel
        id="sidebar"
        panelRef={sidebarRef}
        defaultSize={String(initialLayout.sidebar)}
        minSize={String(SIDEBAR_MIN)}
        maxSize={String(SIDEBAR_MAX)}
        collapsible
        collapsedSize="0"
        onResize={(size, _id, prev) => {
          if (prev === undefined) return; // 首帧不记忆
          const pct = size.asPercentage;
          if (pct <= 1) {
            // 拖过 minSize 被 v4 吸附折叠：单向同步 store（宽度 0 不记忆）
            if (!useUiNav.getState().sidebarCollapsed) {
              useUiNav.setState({ sidebarCollapsed: true });
            }
            return;
          }
          // 从折叠拖出：单向同步 store 为展开
          if (useUiNav.getState().sidebarCollapsed) {
            useUiNav.setState({ sidebarCollapsed: false });
          }
          // 程序性恢复宽度（补间中）不重复记忆；用户拖动的宽度落 localStorage
          if (groupElRef.current?.hasAttribute("data-rail-animating")) return;
          saveSidebarPct(pct);
        }}
        className={collapsed ? "" : "border-r border-[color:var(--border-subtle)]"}
      >
        {!collapsed && <Sidebar />}
      </Panel>
      {!collapsed && (
        <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      )}
      <Panel id="editor" defaultSize={String(initialLayout.editor)} minSize="30">
        <EditorPane />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel
        id="dock"
        defaultSize={String(initialLayout.dock)}
        minSize="17"
        maxSize="34"
        className="border-l border-[color:var(--border-subtle)]"
      >
        <PanelDock />
      </Panel>
    </Group>
  );
}
