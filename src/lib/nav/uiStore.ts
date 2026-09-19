import { create } from "zustand";

// 导航 UI 状态：当前一级视图 + 侧栏折叠。leaf 模块（不依赖 registry），
// 避免 registry ↔ 视图组件 ↔ uiStore 的循环引用。
export const VIEW_STORAGE_KEY = "bixian.nav.view";
export const SIDEBAR_PCT_KEY = "bixian.nav.sidebarPct";

const FALLBACK_VIEW = "write";

interface UiNavState {
  /** 当前一级视图 id（localStorage 持久化；有效性由 registry 加载时自愈） */
  activeView: string;
  /** 侧栏折叠态（会话内状态，不持久化——重启始终展开） */
  sidebarCollapsed: boolean;
  setView: (id: string) => void;
  toggleSidebar: () => void;
}

function readStoredView(): string {
  try {
    const raw = localStorage.getItem(VIEW_STORAGE_KEY);
    if (typeof raw === "string" && raw.length > 0 && raw.length <= 64) return raw;
  } catch {
    // localStorage 不可用（极端环境）：回退默认视图
  }
  return FALLBACK_VIEW;
}

export const useUiNav = create<UiNavState>((set) => ({
  activeView: readStoredView(),
  sidebarCollapsed: false,
  setView: (id) => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, id);
    } catch {
      // 持久化失败不影响会话内切换
    }
    set({ activeView: id });
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
}));

/** 读取用户拖定的侧栏宽度百分比；无记忆/非法值/折叠态 0 返回 null */
export function loadSidebarPct(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_PCT_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && n > 1 && n < 100) return n;
  } catch {
    // localStorage 不可用
  }
  return null;
}

export function saveSidebarPct(pct: number): void {
  try {
    localStorage.setItem(SIDEBAR_PCT_KEY, String(pct));
  } catch {
    // 持久化失败静默
  }
}
