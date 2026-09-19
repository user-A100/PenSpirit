import { create } from "zustand";

// 阅读四边面板状态（books-reader 面板机制移植，Bixian 化为 zustand）：
// 开合是会话态；左（目录）/右（设置）面板的“锁定”持久化 localStorage，
// 锁定 = 常驻打开（close 不生效）+ 正文容器让位（几何由 ReadingShell 处理）。

export type PanelPos = "left" | "right" | "top" | "bottom";

export const READING_LOCKS_KEY = "bixian.reading.locks";

interface Locks {
  navLocked: boolean; // 左面板（目录）
  settingLocked: boolean; // 右面板（设置，T6 挂载）
}

function loadLocks(): Locks {
  try {
    const raw = localStorage.getItem(READING_LOCKS_KEY);
    if (raw != null) {
      const o = JSON.parse(raw) as Partial<Locks>;
      return {
        navLocked: o.navLocked === true,
        settingLocked: o.settingLocked === true,
      };
    }
  } catch {
    // 坏存储/JSON 解析失败 → 全不锁
  }
  return { navLocked: false, settingLocked: false };
}

function persistLocks(l: Locks): void {
  try {
    localStorage.setItem(READING_LOCKS_KEY, JSON.stringify(l));
  } catch {
    // 持久化失败静默（不影响会话内使用）
  }
}

export interface ReadingPanelsState {
  left: boolean;
  right: boolean;
  top: boolean;
  bottom: boolean;
  navLocked: boolean;
  settingLocked: boolean;
  open: (p: PanelPos) => void;
  close: (p: PanelPos) => void;
  toggle: (p: PanelPos) => void;
  setNavLocked: (v: boolean) => void;
  setSettingLocked: (v: boolean) => void;
}

export const useReadingPanels = create<ReadingPanelsState>((set, get) => {
  const locks = loadLocks();
  return {
    left: locks.navLocked, // 锁定 → 进阅读即常驻（books-reader constructor 同款）
    right: locks.settingLocked,
    top: false,
    bottom: false,
    ...locks,
    open: (p) => set({ [p]: true } as Partial<ReadingPanelsState>),
    close: (p) => {
      // 锁定面板常驻，不吃 close（热区收回/点击正文关闭都经由这里）
      if (p === "left" && get().navLocked) return;
      if (p === "right" && get().settingLocked) return;
      set({ [p]: false } as Partial<ReadingPanelsState>);
    },
    toggle: (p) => (get()[p] ? get().close(p) : get().open(p)),
    setNavLocked: (v) => {
      persistLocks({ navLocked: v, settingLocked: get().settingLocked });
      set({ navLocked: v, ...(v ? { left: true } : null) }); // 上锁即常驻；解锁不强制收（等鼠标离开）
    },
    setSettingLocked: (v) => {
      persistLocks({ navLocked: get().navLocked, settingLocked: v });
      set({ settingLocked: v, ...(v ? { right: true } : null) });
    },
  };
});
