import { create } from "zustand";

// 导航 UI 状态：当前一级视图 + 侧栏折叠。leaf 模块（不依赖 registry），
// 避免 registry ↔ 视图组件 ↔ uiStore 的循环引用。
export const VIEW_STORAGE_KEY = "bixian.nav.view";
export const SIDEBAR_PCT_KEY = "bixian.nav.sidebarPct";
export const DOCK_PCT_KEY = "bixian.nav.dockPct";
export const TYPEWRITER_KEY = "bixian.typewriter";

/** dock 面板宽度百分比有效域（与 WriteView 中 minSize/maxSize 对应） */
const DOCK_PCT_MIN = 17;
const DOCK_PCT_MAX = 34;

const FALLBACK_VIEW = "write";

interface UiNavState {
  /** 当前一级视图 id（localStorage 持久化；有效性由 registry 加载时自愈） */
  activeView: string;
  /** 侧栏折叠态（会话内状态，不持久化——重启始终展开） */
  sidebarCollapsed: boolean;
  /** 右侧 dock 折叠态（会话内状态，不持久化——重启始终展开） */
  dockCollapsed: boolean;
  /** 阅读模式返回目标视图 id（进入 read 时由 App 记录上一视图，ReadView 退出时消费；会话内状态） */
  readReturn: string | null;
  /** 打字机滚动：输入时把光标行固定在视口偏上位置（Scrivener Typewriter Scrolling） */
  typewriter: boolean;
  setView: (id: string) => void;
  toggleSidebar: () => void;
  toggleDock: () => void;
  setReadReturn: (id: string | null) => void;
  toggleTypewriter: () => void;
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

function readStoredTypewriter(): boolean {
  try {
    return localStorage.getItem(TYPEWRITER_KEY) === "1";
  } catch {
    return false;
  }
}

export const useUiNav = create<UiNavState>((set) => ({
  activeView: readStoredView(),
  sidebarCollapsed: false,
  dockCollapsed: false,
  readReturn: null,
  typewriter: readStoredTypewriter(),
  setView: (id) => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, id);
    } catch {
      // 持久化失败不影响会话内切换
    }
    set({ activeView: id });
  },
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleDock: () => set((s) => ({ dockCollapsed: !s.dockCollapsed })),
  setReadReturn: (id) => set({ readReturn: id }),
  toggleTypewriter: () =>
    set((s) => {
      const typewriter = !s.typewriter;
      try {
        localStorage.setItem(TYPEWRITER_KEY, typewriter ? "1" : "0");
      } catch {
        // 持久化失败不影响会话内切换
      }
      return { typewriter };
    }),
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

/** 读取用户拖定的右侧 dock 宽度百分比；无记忆/非法值（含 17/34 边界与折叠态 0）返回 null */
export function loadDockPct(): number | null {
  try {
    const raw = localStorage.getItem(DOCK_PCT_KEY);
    const n = raw == null ? NaN : Number(raw);
    if (Number.isFinite(n) && n > DOCK_PCT_MIN && n < DOCK_PCT_MAX) return n;
  } catch {
    // localStorage 不可用
  }
  return null;
}

export function saveDockPct(pct: number): void {
  try {
    localStorage.setItem(DOCK_PCT_KEY, String(pct));
  } catch {
    // 持久化失败静默
  }
}
