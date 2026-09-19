import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "../editor/EditorPane";
import { PanelDock } from "./PanelDock";

// react-resizable-panels v4：Group/Panel/Separator；尺寸用无单位字符串（=百分比）。
// 两个必要的用法约束（实测得出）：
// 1. 显式 defaultLayout（面板 id → 百分比）：面板样式快照在组状态未就绪时回退到该值，
//    不传它面板会停留在首帧样式（flexGrow=0、flexBasis=auto），布局失真。
// 2. Panel 显式 id：defaultLayout 的键即面板 id，useId 派生 id 无法对齐。
// 不用像素 min/max：像素约束经派生换算（依赖 groupSize 测量）引入时序敏感性。
export function AppShell() {
  return (
    <Group
      orientation="horizontal"
      className="h-full bg-[var(--bg-base)]"
      defaultLayout={{ sidebar: 20, editor: 56, dock: 24 }}
    >
      <Panel
        id="sidebar"
        defaultSize="20"
        minSize="14"
        maxSize="28"
        className="border-r border-[color:var(--border-subtle)]"
      >
        <Sidebar />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel id="editor" defaultSize="56" minSize="30">
        <EditorPane />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel
        id="dock"
        defaultSize="24"
        minSize="17"
        maxSize="34"
        className="border-l border-[color:var(--border-subtle)]"
      >
        <PanelDock />
      </Panel>
    </Group>
  );
}
