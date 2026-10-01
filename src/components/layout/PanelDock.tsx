import type { ComponentType } from "react";
import { PanelRightClose } from "lucide-react";
import { ForeshadowPanel } from "../foreshadow/ForeshadowPanel";
import { CharactersPanel } from "../characters/CharactersPanel";
import { OutlineDockPanel } from "../outline/OutlineDockPanel";
import { PlotBlocksPanel } from "../plot/PlotBlocksPanel";
import { MetaDockPanel } from "../meta/MetaDockPanel";
import { LinksDockPanel } from "../links/LinksDockPanel";
import { CollectionsDockPanel } from "../collections/CollectionsDockPanel";
import { RefDockPanel } from "../reference/RefDockPanel";
import { NamesPanel } from "../names/NamesPanel";
import { getView } from "../../lib/nav/registry";
import { useUiNav } from "../../lib/nav/uiStore";

// 右侧 dock 卡片：顶部面板标题 + 内容。面板切换由右侧竖条 DockRail 负责
// （阶段 1：原 9 个 tab 平分一行、文字全被截断，改为竖条图标 + 这里的完整标题）。
const PANEL_COMPONENTS: Record<string, ComponentType> = {
  meta: MetaDockPanel,
  links: LinksDockPanel,
  collections: CollectionsDockPanel,
  reference: RefDockPanel,
  foreshadow: ForeshadowPanel,
  outline: OutlineDockPanel,
  characters: CharactersPanel,
  plot: PlotBlocksPanel,
  names: NamesPanel,
};

export function PanelDock() {
  const activeView = useUiNav((s) => s.activeView);
  const stored = useUiNav((s) => s.dockPanels[activeView]);
  const toggleDock = useUiNav((s) => s.toggleDock);
  const panels = getView(activeView)?.dockPanels ?? [];
  const activePanel = panels.find((p) => p.id === stored) ?? panels[0];

  if (!activePanel) return <div className="h-full" />;
  const Content = PANEL_COMPONENTS[activePanel.id];
  const Icon = activePanel.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="group flex h-10 shrink-0 items-center gap-2 pl-3.5 pr-2">
        <Icon size={15} strokeWidth={1.75} className="shrink-0 text-[color:var(--text-faint)]" />
        <span className="min-w-0 flex-1 truncate text-ui font-medium text-[color:var(--text-primary)]">
          {activePanel.label}
        </span>
        {activePanel.group && (
          <span className="shrink-0 text-2xs text-[color:var(--text-faint)]">{activePanel.group}</span>
        )}
        <button
          onClick={toggleDock}
          aria-label="折叠右侧面板"
          data-tip="折叠右侧面板"
          data-tip-key="Ctrl+\"
          className="rounded-[var(--r-control)] p-1 text-[color:var(--text-faint)] opacity-0 transition-[opacity,background-color] duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-secondary)] focus-visible:opacity-100 group-hover:opacity-100"
        >
          <PanelRightClose size={15} />
        </button>
      </div>
      <div key={activePanel.id} className="panel-swap flex min-h-0 flex-1 flex-col">
        {Content ? <Content /> : null}
      </div>
    </div>
  );
}
