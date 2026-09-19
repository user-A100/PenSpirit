import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "../editor/EditorPane";
import { PanelDock } from "./PanelDock";

// react-resizable-panels v4：Group/Panel/Separator；尺寸无单位字符串=百分比（数字=像素）
export function AppShell() {
  return (
    <Group orientation="horizontal" className="h-full bg-[var(--bg-base)]">
      <Panel
        defaultSize="20"
        minSize={240}
        maxSize={320}
        className="border-r border-[color:var(--border-subtle)]"
      >
        <Sidebar />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel defaultSize="56" minSize="30">
        <EditorPane />
      </Panel>
      <Separator className="w-1 bg-transparent transition-colors duration-150 hover:bg-[var(--accent-dim)]" />
      <Panel
        defaultSize="24"
        minSize={220}
        maxSize={380}
        className="border-l border-[color:var(--border-subtle)]"
      >
        <PanelDock />
      </Panel>
    </Group>
  );
}
