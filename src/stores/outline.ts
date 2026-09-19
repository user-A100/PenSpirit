import { create } from "zustand";

// M3-T7 悬浮大纲：open 与浮窗拖拽位置（left/top）持久化在 localStorage，
// 重启回到原位。jumpTarget 是「编辑器待定位文本」的一次性通道——
// 点击大纲条目 request 写入，ChapterEditor 的 effect consume 取走并清空
// （与 search store 的 jumpText/clearJump 同构，consume 自带读取+清空）。

export const OUTLINE_STORAGE_KEY = "bixian.outline";

interface Persisted {
  open: boolean;
  /** 拖拽落点；null = 从未拖过，浮窗用 CSS 默认位（右上 15vh） */
  left: number | null;
  top: number | null;
}

function loadPersisted(): Persisted {
  try {
    const v = JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY) ?? "");
    if (typeof v === "object" && v !== null && typeof v.open === "boolean") {
      return {
        open: v.open,
        left: Number.isFinite(v.left) ? v.left : null,
        top: Number.isFinite(v.top) ? v.top : null,
      };
    }
  } catch {
    // 无记录或残留非法 JSON：回退默认
  }
  return { open: false, left: null, top: null };
}

function persist(s: Persisted) {
  try {
    localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // localStorage 不可写：静默，会话内仍生效
  }
}

interface OutlineState extends Persisted {
  /** 待编辑器定位的文本；编辑器消费后调用 consume 取走 */
  jumpTarget: string | null;
  toggle(): void;
  request(text: string): void;
  consume(): string | null;
  /** 记住拖拽落点（头部 pointerup 时调用） */
  setPos(left: number, top: number): void;
}

export const useOutline = create<OutlineState>((set, get) => ({
  ...loadPersisted(),
  jumpTarget: null,

  toggle: () => {
    const open = !get().open;
    persist({ open, left: get().left, top: get().top });
    set({ open });
  },
  request: (text) => set({ jumpTarget: text }),
  consume: () => {
    const t = get().jumpTarget;
    if (t != null) set({ jumpTarget: null });
    return t;
  },
  setPos: (left, top) => {
    persist({ open: get().open, left, top });
    set({ left, top });
  },
}));
