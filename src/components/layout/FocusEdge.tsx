import { useEffect, useRef, useState } from "react";
import { Minimize2 } from "lucide-react";
import { Sidebar } from "./Sidebar";
import { useUiNav } from "../../lib/nav/uiStore";
import { commandShortcut } from "../../lib/commands";

// 专注模式的边缘唤出（Zen 紧凑模式）：鼠标贴左缘 10px 浮出目录卡（.25s 轻弹），
// 离开 150ms 后收回；顶部中央悬停出现「退出专注」胶囊。只在专注模式挂载。
const HIDE_DELAY = 150;

export function FocusEdge() {
  const toggleFocusMode = useUiNav((s) => s.toggleFocusMode);
  const [open, setOpen] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = () => {
    window.clearTimeout(timer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), HIDE_DELAY);
  };

  return (
    <>
      {/* 左缘热区 */}
      <div aria-hidden className="fixed bottom-0 left-0 top-0 z-[60] w-2.5" onMouseEnter={show} />
      <div
        data-focus-sidebar=""
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        className={`zen-card fixed bottom-[var(--sep)] left-[var(--sep)] top-[var(--sep)] z-[61] w-72 transition-[transform,opacity] ${
          open
            ? "translate-x-0 opacity-100 duration-[var(--dur-slow)] [transition-timing-function:var(--ease-spring)]"
            : "pointer-events-none -translate-x-[calc(100%+var(--sep)*2)] opacity-0 duration-[var(--dur-md)] ease-in"
        }`}
        style={{ boxShadow: "var(--shadow-overlay)" }}
      >
        {open && <Sidebar />}
      </div>
      {/* 顶部中央退出胶囊 */}
      <div className="group fixed left-1/2 top-0 z-[60] flex h-6 w-64 -translate-x-1/2 justify-center">
        <button
          onClick={toggleFocusMode}
          className="mt-1.5 flex h-7 items-center gap-1.5 rounded-full bg-[var(--bg-elevated)] px-3 text-xs text-[color:var(--text-secondary)] opacity-0 transition-opacity duration-[var(--dur-md)] [box-shadow:var(--shadow-overlay)] hover:text-[color:var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Minimize2 size={13} />
          退出专注
          <kbd className="font-sans text-2xs text-[color:var(--text-faint)]">{commandShortcut("view.focusMode")}</kbd>
        </button>
      </div>
    </>
  );
}
