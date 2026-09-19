import { PanelLeftOpen, PenTool, Settings } from "lucide-react";
import { getViews } from "../../lib/nav/registry";
import { useUiNav } from "../../lib/nav/uiStore";
import { useSettings } from "../../stores/settings";

// Obsidian 式竖条导航：48px 永远可见——顶部笔仙 logo、中部一级视图图标、底部设置。
// 激活态：左侧 2px accent 竖条 + accent-dim 底 + 图标 text-primary。
const ICON_BTN =
  "relative flex h-9 w-9 items-center justify-center rounded-md transition-colors duration-150";

export function Ribbon() {
  const activeView = useUiNav((s) => s.activeView);
  const sidebarCollapsed = useUiNav((s) => s.sidebarCollapsed);
  const setView = useUiNav((s) => s.setView);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const openSettings = useSettings((s) => s.open);

  return (
    <aside className="flex h-full w-12 flex-none flex-col items-center border-r border-[color:var(--border-subtle)] bg-[var(--bg-panel)]">
      {/* 顶部：笔仙 logo */}
      <div className="flex h-12 shrink-0 items-center justify-center border-b border-[color:var(--border-subtle)]" title="笔仙">
        <PenTool size={18} className="text-[color:var(--accent)]" />
      </div>

      {/* 中部：一级视图图标 */}
      <nav className="flex flex-1 flex-col items-center gap-1 py-2">
        {getViews().map((v) => {
          const active = activeView === v.id;
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              title={v.label}
              onClick={() => {
                // 再次点击当前视图图标 = 折叠/展开该视图侧栏
                if (active) toggleSidebar();
                else setView(v.id);
              }}
              className={
                active
                  ? `${ICON_BTN} bg-[var(--accent-dim)] text-[color:var(--text-primary)]`
                  : `${ICON_BTN} text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]`
              }
            >
              {active && (
                <span
                  aria-hidden
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--accent)]"
                />
              )}
              <Icon size={18} className="shrink-0" />
            </button>
          );
        })}
      </nav>

      {/* 底部：展开侧栏（折叠时）+ 设置 */}
      <div className="flex shrink-0 flex-col items-center gap-1 pb-2">
        {activeView === "write" && sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            title="展开侧栏（Ctrl+B）"
            className={`${ICON_BTN} text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]`}
          >
            <PanelLeftOpen size={18} className="shrink-0" />
          </button>
        )}
        <button
          onClick={openSettings}
          title="设置"
          className={`${ICON_BTN} text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]`}
        >
          <Settings size={18} className="shrink-0" />
        </button>
      </div>
    </aside>
  );
}
