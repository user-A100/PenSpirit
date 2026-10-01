import { Fragment } from "react";
import { getView } from "../../lib/nav/registry";
import { useUiNav } from "../../lib/nav/uiStore";

// 右侧面板竖条（与左侧 Ribbon 对称，贴在背板上）：一个图标一个面板，按组以细线分隔。
// 点非当前面板 = 切换并展开 dock；点当前面板 = 折叠/展开 dock（同 Ribbon 再点当前视图收侧栏）。
const BTN =
  "relative flex h-9 w-9 items-center justify-center rounded-[var(--r-control)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-md)] active:scale-[0.96]";

export function DockRail() {
  const activeView = useUiNav((s) => s.activeView);
  const dockCollapsed = useUiNav((s) => s.dockCollapsed);
  const stored = useUiNav((s) => s.dockPanels[activeView]);
  const setDockPanel = useUiNav((s) => s.setDockPanel);
  const toggleDock = useUiNav((s) => s.toggleDock);
  const panels = getView(activeView)?.dockPanels ?? [];
  if (panels.length === 0) return null;
  const current = panels.some((p) => p.id === stored) ? stored : panels[0].id;

  return (
    <nav aria-label="右侧面板" className="flex w-12 shrink-0 flex-col items-center gap-1 py-1">
      {panels.map((p, i) => {
        const Icon = p.icon;
        const active = !dockCollapsed && p.id === current;
        const newGroup = i > 0 && p.group !== panels[i - 1].group;
        return (
          <Fragment key={p.id}>
            {newGroup && <span aria-hidden className="my-1 h-px w-5 bg-[var(--hairline)]" />}
            <button
              data-dock-panel={p.id}
              aria-label={p.label}
              aria-pressed={active}
              data-tip={p.label}
              data-tip-side="left"
              data-tip-key={i === 0 ? "Ctrl+\\" : undefined}
              onClick={() => {
                if (p.id === current) {
                  toggleDock();
                  return;
                }
                setDockPanel(activeView, p.id);
                if (dockCollapsed) toggleDock();
              }}
              className={
                active
                  ? `${BTN} bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]`
                  : `${BTN} text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]`
              }
            >
              <Icon size={17} strokeWidth={1.75} className="shrink-0" />
            </button>
          </Fragment>
        );
      })}
    </nav>
  );
}
