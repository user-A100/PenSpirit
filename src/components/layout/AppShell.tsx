import { Group, Panel, Separator } from "react-resizable-panels";
import { Sidebar } from "./Sidebar";
import { EditorPane } from "../editor/EditorPane";
import { PanelDock } from "./PanelDock";

// react-resizable-panels v4：Group/Panel/Separator；尺寸无单位字符串=百分比（数字=像素）
export function AppShell() {
  return (
    <Group orientation="horizontal" className="h-full">
      <Panel defaultSize="18" minSize="12" maxSize="30" className="border-r" style={{ borderRightColor: "var(--border)" }}>
        <Sidebar />
      </Panel>
      <Separator className="w-1 bg-transparent hover:bg-[var(--accent)] transition-colors" />
      <Panel defaultSize="58" minSize="30">
        <EditorPane />
      </Panel>
      <Separator className="w-1 bg-transparent hover:bg-[var(--accent)] transition-colors" />
      <Panel defaultSize="24" minSize="16" maxSize="40" className="border-l" style={{ borderLeftColor: "var(--border)" }}>
        <PanelDock />
      </Panel>
    </Group>
  );
}
