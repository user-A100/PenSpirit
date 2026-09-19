import { useEffect } from "react";
import { Ribbon } from "./components/layout/Ribbon";
import { SettingsModal } from "./components/settings/SettingsModal";
import { WriteView } from "./views/WriteView";
import { BumpView } from "./views/BumpView";
import { getViews } from "./lib/nav/registry";
import { useUiNav } from "./lib/nav/uiStore";

export default function App() {
  const activeView = useUiNav((s) => s.activeView);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);

  // 双保险：registry 加载时已自愈无效视图 id，这里防御运行期脏值
  const current = getViews().some((v) => v.id === activeView) ? activeView : "write";

  // Ctrl+B 折叠/展开侧栏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleSidebar]);

  return (
    <>
      <div className="flex h-full w-full bg-[var(--bg-base)]">
        <Ribbon />
        <main className="min-w-0 flex-1">
          {/* WriteView 常挂（hidden 而非卸载）保住编辑器/dock/侧栏的内部状态 */}
          <div className={current === "write" ? "h-full" : "hidden"}>
            <WriteView />
          </div>
          {current === "bump" && <BumpView />}
        </main>
      </div>
      <SettingsModal />
    </>
  );
}
