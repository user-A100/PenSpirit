import { useEffect, useRef } from "react";
import { Ribbon } from "./components/layout/Ribbon";
import { SettingsModal } from "./components/settings/SettingsModal";
import { SearchPanel } from "./components/search/SearchPanel";
import { Toaster } from "./components/ui/Toaster";
import { ConfirmHost } from "./components/ui/ConfirmHost";
import { MenuHost } from "./components/ui/MenuHost";
import { TooltipHost } from "./components/ui/TooltipHost";
import { CommandPalette } from "./components/ui/CommandPalette";
import { DiffReview } from "./components/chat/DiffReview";
import { VarsDialog } from "./components/chat/VarsDialog";
import { WriteView } from "./views/WriteView";
import { FocusEdge } from "./components/layout/FocusEdge";
import { getView, getViews } from "./lib/nav/registry";
import { useUiNav } from "./lib/nav/uiStore";
import { installKeyDispatcher } from "./lib/commands";
import { registerBuiltinCommands } from "./lib/builtinCommands";
import { ThemeProvider, useAppearance } from "./themes/ThemeProvider";
import { findTexture, TEXTURE_TILE_PX } from "./themes/textures";

export default function App() {
  const activeView = useUiNav((s) => s.activeView);
  const focusMode = useUiNav((s) => s.focusMode);
  const setReadReturn = useUiNav((s) => s.setReadReturn);
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

  // 全局快捷键统一走命令中枢（lib/commands）：内置命令注册 + 捕获阶段分发。
  // Ctrl+B 侧栏 / Ctrl+\ dock / Alt+O 悬浮大纲 / Ctrl+Shift+F 搜索 / Alt+←→ 历史 /
  // Alt+S 分屏 / Ctrl+N 新建章节 / Ctrl+, 设置
  useEffect(() => {
    const offCommands = registerBuiltinCommands();
    const offKeys = installKeyDispatcher();
    return () => {
      offKeys();
      offCommands();
    };
  }, []);

  return (
    <ThemeProvider>
      <div
        data-focus-mode={focusMode ? "" : undefined}
        className="flex h-full w-full bg-[var(--bg-backdrop)] text-[color:var(--text-primary)]"
      >
        {!focusMode && <Ribbon />}
        {/* Zen 骨架（阶段 1）：导航与侧栏贴在背板上、无描边；只有内容是浮起的卡片。
            写作视图自己排三张卡（稿纸 / AI / 右侧面板）；其余视图整体一张卡。
            卡片 overflow-hidden 负责把内部方角背景裁成圆角；弹窗/浮窗走 fixed 定位不受裁切。 */}
        <main className={`min-w-0 flex-1 py-[var(--sep)] ${focusMode ? "px-[var(--sep)]" : ""}`}>
          {/* WriteView 常挂（hidden 而非卸载）保住编辑器/dock/侧栏的内部状态 */}
          <div className={current === "write" ? "h-full" : "hidden"}>
            <WriteView />
          </div>
          {/* 其余视图按注册表渲染；read 全屏覆盖（不常挂：进入时重建以重置进度恢复/计时） */}
          {current !== "write" && (
            <div className="zen-card view-enter mr-[var(--sep)] h-full">
              {(() => {
                const Active = getView(current)?.Component;
                return Active ? <Active /> : null;
              })()}
            </div>
          )}
        </main>
        {focusMode && current === "write" && <FocusEdge />}
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
      <ConfirmHost />
      <MenuHost />
      <Toaster />
      <TooltipHost />
      <CommandPalette />
      <DiffReview />
      <VarsDialog />
    </ThemeProvider>
  );
}
