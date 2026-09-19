import { useState, type ComponentType } from "react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { StylePanel } from "../styles/StylePanel";
import { StatsPanel } from "../stats/StatsPanel";
import { getView } from "../../lib/nav/registry";
import { useUiNav } from "../../lib/nav/uiStore";

// tab 由当前一级视图的 dockPanels 驱动（registry 注册）；
// 内容按 DockPanelDef.id 映射：已实现的渲染真实组件，其余保持空态。
// 空态说明按规格里程碑标注：人物=M2、大纲/伏笔=M3。
const PANEL_EMPTY_TEXT: Record<string, string> = {
  outline: "章节结构与排序，M3 里程碑提供",
  characters: "人物图谱与关系网络，M2 里程碑提供",
  foreshadow: "伏笔登记与回收追踪，M3 里程碑提供",
  styles: "",
};

const PANEL_COMPONENTS: Record<string, ComponentType> = {
  styles: StylePanel,
  stats: StatsPanel,
};

export function PanelDock() {
  const activeView = useUiNav((s) => s.activeView);
  const dockCollapsed = useUiNav((s) => s.dockCollapsed);
  const toggleDock = useUiNav((s) => s.toggleDock);
  const panels = getView(activeView)?.dockPanels ?? [];
  const [tab, setTab] = useState<string>(() => panels[0]?.id ?? "");
  const activePanel = panels.find((p) => p.id === tab) ?? panels[0];

  // 视图无 dock 面板（如碰碰车）时不渲染 tab 栏
  if (!activePanel) return <div className="h-full bg-[var(--bg-panel)]" />;

  const Content = PANEL_COMPONENTS[activePanel.id];
  const ActiveIcon = activePanel.icon;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)]">
      {/* 标签栏 36px：图标 + 文字，激活态底部 2px accent 条 */}
      <div className="flex h-9 shrink-0 border-b border-[color:var(--border-subtle)]">
        {panels.map((p) => {
          const active = p.id === activePanel.id;
          const Icon = p.icon;
          return (
            <button
              key={p.id}
              onClick={() => setTab(p.id)}
              className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-xs transition-colors duration-150 ${
                active
                  ? "text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              <Icon size={14} className="shrink-0" />
              <span className="truncate">{p.label}</span>
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-0.5 bg-[color:var(--accent)]"
                />
              )}
            </button>
          );
        })}
        {/* 折叠入口（同 Sidebar 的 PanelLeftClose 手法；展开走 Ctrl+\ 或拖出） */}
        <button
          onClick={toggleDock}
          title={dockCollapsed ? "展开右侧面板（Ctrl+\\）" : "折叠右侧面板（Ctrl+\\）"}
          className="flex shrink-0 items-center justify-center px-2 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
        >
          {dockCollapsed ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
        </button>
      </div>

      {/* 已实现标签渲染真实面板；其余空态：大图标 + 功能名 + 一句说明 */}
      {Content ? (
        <Content />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <ActiveIcon size={32} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
          <div className="text-sm text-[color:var(--text-secondary)]">{activePanel.label}</div>
          <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
            {PANEL_EMPTY_TEXT[activePanel.id] ?? ""}
          </div>
        </div>
      )}
    </div>
  );
}
