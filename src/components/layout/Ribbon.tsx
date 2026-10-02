import { PanelLeftOpen, PenTool, Settings } from "lucide-react";
import { getViews } from "../../lib/nav/registry";
import { useUiNav } from "../../lib/nav/uiStore";
import { commandShortcut } from "../../lib/commands";
import { useSettings } from "../../stores/settings";

// 左侧竖条导航（阶段 1 Zen 化）：贴在背板上、无底色无描边；
// 激活态 = 一小片稿纸（卡片色 + 极薄阴影，Zen 选中标签手法），非激活图标降一档颜色。
const ICON_BTN =
  "relative flex h-9 w-9 items-center justify-center rounded-[var(--r-control)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-md)] active:scale-[0.96]";
const IDLE = `${ICON_BTN} text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]`;

export function Ribbon() {
  const activeView = useUiNav((s) => s.activeView);
  const sidebarCollapsed = useUiNav((s) => s.sidebarCollapsed);
  const setView = useUiNav((s) => s.setView);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const openSettings = useSettings((s) => s.open);

  return (
    <aside aria-label="视图" className="flex h-full w-12 flex-none flex-col items-center">
      {/* 顶部：笔仙 logo（与右侧竖条首个按钮同一水平线） */}
      <div className="flex h-12 shrink-0 items-center justify-center" data-tip="笔仙" data-tip-side="right">
        <PenTool size={18} className="text-[color:var(--accent)]" />
      </div>

      {/* 中部：一级视图图标 */}
      <nav className="flex flex-1 flex-col items-center gap-1 py-1">
        {getViews().map((v) => {
          const active = activeView === v.id;
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              aria-label={v.label}
              aria-current={active ? "page" : undefined}
              data-view={v.id}
              data-tip={active && v.id === "write" ? `${v.label}（再点一次折叠侧栏）` : v.label}
              data-tip-side="right"
              data-tip-key={active && v.id === "write" ? commandShortcut("view.toggleSidebar") : undefined}
              onClick={() => {
                // 再次点击当前视图图标 = 折叠/展开该视图侧栏
                if (active) toggleSidebar();
                else setView(v.id);
              }}
              className={
                active
                  ? `${ICON_BTN} bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]`
                  : IDLE
              }
            >
              <Icon size={18} strokeWidth={1.75} className="shrink-0" />
            </button>
          );
        })}
      </nav>

      {/* 底部：展开侧栏（折叠时）+ 设置 */}
      <div className="flex shrink-0 flex-col items-center gap-1 pb-1">
        {activeView === "write" && sidebarCollapsed && (
          <button
            onClick={toggleSidebar}
            aria-label="展开侧栏"
            data-tip="展开侧栏"
            data-tip-side="right"
            data-tip-key={commandShortcut("view.toggleSidebar")}
            className={IDLE}
          >
            <PanelLeftOpen size={18} strokeWidth={1.75} className="shrink-0" />
          </button>
        )}
        <button
          onClick={() => openSettings()}
          aria-label="设置"
          title="设置"
          data-tip="设置"
          data-tip-side="right"
          data-tip-key={commandShortcut("settings.open")}
          className={IDLE}
        >
          <Settings size={18} strokeWidth={1.75} className="shrink-0" />
        </button>
      </div>
    </aside>
  );
}
