import { useState } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { ChapterEditor } from "./ChapterEditor";
import { AiDock } from "../chat/AiDock";

// 垂直 PanelGroup：编辑器上、AI Dock 下。用法约束同 AppShell（v4 实测）：
// 显式 defaultLayout + Panel 显式 id + 无单位字符串（=百分比）尺寸。
// AiDock 折叠走 Panel 原生 collapsible：collapsedSize=36px，collapse()/expand() 切换，
// onResize 按像素判定折叠态驱动 AiDock 渲染完整面板或 36px 条。
const COLLAPSED_PX = 36;

export function EditorPane() {
  const panelRef = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Group
      orientation="vertical"
      className="h-full bg-[var(--bg-base)]"
      defaultLayout={{ editor: 68, aidock: 32 }}
    >
      <Panel id="editor" defaultSize="68" minSize="30">
        <ChapterEditor />
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
