import { useEffect, useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { ChapterEditor } from "./ChapterEditor";
import { AiDock } from "../chat/AiDock";
import { useWorkspace } from "../../stores/workspace";
import { useUiNav } from "../../lib/nav/uiStore";

// 垂直 PanelGroup：编辑卡在上、AI 卡在下，中间是 --sep 透明缝（阶段 1 Zen 骨架）。用法约束同 WriteView（v4 实测）：
// 显式 defaultLayout + Panel 显式 id + 无单位字符串（=百分比）尺寸。
// AiDock 折叠走 Panel 原生 collapsible：collapsedSize=36px，collapse()/expand() 切换，
// onResize 按像素判定折叠态驱动 AiDock 渲染完整面板或 36px 条。
// 分屏（M7 批次5）：编辑区内部再嵌一层 Group——vertical=左右并排、horizontal=上下堆叠；
// 活动窗格的卡片外描一圈淡 accent（activePane，点击窗格内任意编辑器即跟随）。
const COLLAPSED_PX = 36;

function PaneShell({ pane }: { pane: "a" | "b" }) {
  const active = useWorkspace((s) => s.activePane === pane);
  return (
    <div
      data-pane-active={active ? "" : undefined}
      className={`zen-card h-full transition-[box-shadow] duration-[var(--dur-md)] ${active ? "zen-card-active" : ""}`}
    >
      <ChapterEditor pane={pane} />
    </div>
  );
}

export function EditorPane() {
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const splitAxis = useWorkspace((s) => s.splitAxis);
  const focusMode = useUiNav((s) => s.focusMode);
  const aiCollapsed = useUiNav((s) => s.aiCollapsed);

  // store → 面板：命令（Ctrl+J / 气泡菜单）改变折叠态时驱动面板；面板 → store 见 onResize
  useEffect(() => {
    if (aiCollapsed === collapsed) return;
    if (aiCollapsed) panelRef.current?.collapse();
    else panelRef.current?.expand();
    // collapsed 由 onResize 回写，不作依赖（避免拖拽中来回触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiCollapsed]);

  const editorArea =
    splitAxis === "none" ? (
      <div className="zen-card h-full">
        <ChapterEditor pane="a" />
      </div>
    ) : splitAxis === "vertical" ? (
      <Group orientation="horizontal" className="h-full bg-transparent" defaultLayout={{ "pane-a": 50, "pane-b": 50 }}>
        <Panel id="pane-a" defaultSize="50" minSize="20">
          <PaneShell pane="a" />
        </Panel>
        <Separator className="zen-splitter zen-splitter-x" />
        <Panel id="pane-b" defaultSize="50" minSize="20">
          <PaneShell pane="b" />
        </Panel>
      </Group>
    ) : (
      <Group orientation="vertical" className="h-full bg-transparent" defaultLayout={{ "pane-a": 50, "pane-b": 50 }}>
        <Panel id="pane-a" defaultSize="50" minSize="20">
          <PaneShell pane="a" />
        </Panel>
        <Separator className="zen-splitter zen-splitter-y" />
        <Panel id="pane-b" defaultSize="50" minSize="20">
          <PaneShell pane="b" />
        </Panel>
      </Group>
    );

  return (
    // 专注模式：AI 卡与分隔缝 CSS 摘除（同侧栏折叠手法），只留稿纸
    <div className="h-full" data-ai-hidden={focusMode ? "" : undefined}>
    <Group
      orientation="vertical"
      className="h-full bg-transparent"
      defaultLayout={{ editor: 68, aidock: 32 }}
    >
      <Panel id="editor" defaultSize="68" minSize="30">
        {editorArea}
      </Panel>
      {!focusMode && <Separator className="zen-splitter zen-splitter-y" />}
      <Panel
        id="aidock"
        className="panel-aidock"
        panelRef={panelRef}
        defaultSize="32"
        minSize="15"
        maxSize="60"
        collapsible
        collapsedSize={`${COLLAPSED_PX}px`}
        onResize={(size, _id, prev) => {
          if (prev === undefined) return; // 首帧：保持初值 false
          if (useUiNav.getState().focusMode) return; // 专注模式 CSS 摘除不算折叠
          const c = size.inPixels <= COLLAPSED_PX + 4;
          setCollapsed(c);
          if (useUiNav.getState().aiCollapsed !== c) useUiNav.setState({ aiCollapsed: c });
        }}
      >
        <div className="zen-card h-full">
          <AiDock collapsed={collapsed} onToggle={() => useUiNav.getState().setAiCollapsed(!collapsed)} />
        </div>
      </Panel>
    </Group>
    </div>
  );
}
