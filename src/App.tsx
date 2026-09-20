import { useEffect, useRef } from "react";
import { Ribbon } from "./components/layout/Ribbon";
import { SettingsModal } from "./components/settings/SettingsModal";
import { SearchPanel } from "./components/search/SearchPanel";
import { WriteView } from "./views/WriteView";
import { getView, getViews } from "./lib/nav/registry";
import { useUiNav } from "./lib/nav/uiStore";
import { useOutline } from "./stores/outline";
import { useSearch } from "./stores/search";
import { ThemeProvider, useAppearance } from "./themes/ThemeProvider";
import { findTexture, TEXTURE_TILE_PX } from "./themes/textures";

export default function App() {
  const activeView = useUiNav((s) => s.activeView);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const toggleDock = useUiNav((s) => s.toggleDock);
  const setReadReturn = useUiNav((s) => s.setReadReturn);
  const openSearch = useSearch((s) => s.openPanel);
  const texture = useAppearance((s) => s.texture);

  // 双保险：registry 加载时已自愈无效视图 id，这里防御运行期脏值
  const current = getViews().some((v) => v.id === activeView) ? activeView : "write";

  // 进入阅读模式时记录来源视图，ReadView 的 Esc 退出据此回去（readReturn 消费在 ReadView）
  const prevViewRef = useRef(activeView);
  useEffect(() => {
    if (activeView === "read" && prevViewRef.current !== "read") {
      setReadReturn(prevViewRef.current);
    }
    prevViewRef.current = activeView;
  }, [activeView, setReadReturn]);

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

  // Ctrl+\ 折叠/展开右侧 dock（与 Ctrl+B 侧栏并排）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key === "\\") {
        e.preventDefault();
        toggleDock();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleDock]);

  // Alt+O 悬浮大纲（写作模式下的章节导航浮窗）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        useOutline.getState().toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Ctrl+Shift+F 全书搜索（与 Ribbon 无关的全局快捷键）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSearch]);

  return (
    <ThemeProvider>
      <div className="flex h-full w-full bg-[var(--bg-base)]">
        <Ribbon />
        <main className="min-w-0 flex-1">
          {/* WriteView 常挂（hidden 而非卸载）保住编辑器/dock/侧栏的内部状态 */}
          <div className={current === "write" ? "h-full" : "hidden"}>
            <WriteView />
          </div>
          {/* 其余视图按注册表渲染；read 全屏覆盖（不常挂：进入时重建以重置进度恢复/计时） */}
          {current !== "write" && (() => {
            const Active = getView(current)?.Component;
            return Active ? <Active /> : null;
          })()}
        </main>
        {/* 纸张纹理覆盖层（M3-T3）：z-200 高于全部面板/弹窗，均匀铺满整页（Maple 整页纸感）；
            preset="none" 时不渲染。定位样式见 styles.css #texture-layer 分区 */}
        {texture.preset !== "none" && (
          <div
            id="texture-layer"
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[200]"
            style={{
              backgroundImage: findTexture(texture.preset)?.css,
              backgroundSize: `${TEXTURE_TILE_PX * texture.scale}px`,
              opacity: texture.opacity,
              mixBlendMode: texture.blend,
            }}
          />
        )}
      </div>
      <SettingsModal />
      <SearchPanel />
    </ThemeProvider>
  );
}
