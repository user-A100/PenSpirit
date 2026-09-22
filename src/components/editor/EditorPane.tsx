import { useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { ChapterEditor } from "./ChapterEditor";
import { AiDock } from "../chat/AiDock";
import { useWorkspace } from "../../stores/workspace";

// 垂直 PanelGroup：编辑区上、AI Dock 下。用法约束同 WriteView（v4 实测）：
// 显式 defaultLayout + Panel 显式 id + 无单位字符串（=百分比）尺寸。
// AiDock 折叠走 Panel 原生 collapsible：collapsedSize=36px，collapse()/expand() 切换，
// onResize 按像素判定折叠态驱动 AiDock 渲染完整面板或 36px 条。
// 分屏（M7 批次5）：编辑区内部再嵌一层 Group——vertical=左右并排、horizontal=上下堆叠；
// 每个窗格顶边 2px accent 提示活动窗格（activePane，点击窗格内任意编辑器即跟随）。
const COLLAPSED_PX = 36;

function PaneShell({ pane }: { pane: "a" | "b" }) {
  const active = useWorkspace((s) => s.activePane === pane);
  return (
    <div
      data-pane-active={active ? "" : undefined}
      className={`h-full border-t-2 ${active ? "border-[color:var(--accent)]" : "border-transparent"}`}
    >
      <ChapterEditor pane={pane} />
    </div>
  );
}

export function EditorPane() {
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const splitAxis = useWorkspace((s) => s.splitAxis);

  const editorArea =
    splitAxis === "none" ? (
      <ChapterEditor pane="a" />
    ) : splitAxis === "vertical" ? (
      <Group orientation="horizontal" className="h-full bg-transparent" defaultLayout={{ "pane-a": 50, "pane-b": 50 }}>
        <Panel id="pane-a" defaultSize="50" minSize="20">
          <PaneShell pane="a" />
        </Panel>
        <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
        <Panel id="pane-b" defaultSize="50" minSize="20">
          <PaneShell pane="b" />
        </Panel>
      </Group>
    ) : (
      <Group orientation="vertical" className="h-full bg-transparent" defaultLayout={{ "pane-a": 50, "pane-b": 50 }}>
        <Panel id="pane-a" defaultSize="50" minSize="20">
          <PaneShell pane="a" />
        </Panel>
        <Separator className="h-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
        <Panel id="pane-b" defaultSize="50" minSize="20">
          <PaneShell pane="b" />
        </Panel>
      </Group>
    );

  return (
    <Group
      orientation="vertical"
      className="h-full bg-transparent"
      defaultLayout={{ editor: 68, aidock: 32 }}
    >
      <Panel id="editor" defaultSize="68" minSize="30">
        {editorArea}
      </Panel>
      <Separator className="h-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel
        id="aidock"
        panelRef={panelRef}
        defaultSize="32"
        minSize="15"
        maxSize="60"
        collapsible
        collapsedSize={`${COLLAPSED_PX}px`}
        onResize={(size, _id, prev) => {
          if (prev === undefined) return; // 首帧：保持初值 false
          setCollapsed(size.inPixels <= COLLAPSED_PX + 4);
        }}
      >
        <AiDock
          collapsed={collapsed}
          onToggle={() => (collapsed ? panelRef.current?.expand() : panelRef.current?.collapse())}
        />
      </Panel>
    </Group>
  );
}
