import { create } from "zustand";
import { api } from "../lib/tauri";

// M2-T11 今日写作字数。差量由 ChapterEditor 从 TipTap transaction 里算好传进来
// （粘贴/AI 采纳不计、跳变过大丢弃），这里负责乐观累加 + 落库。
//
// 统计是尽力而为：落库失败不打断写作，也不弹错（失败只影响徽章数字的准确度）。

/** 本地日期 YYYY-MM-DD（与后端 date('now','localtime') 同一口径） */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地分钟串，用于「同一分钟只记一次活跃」 */
export function localMinute(d = new Date()): string {
  return `${localDay(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface StatsState {
  bookId: number | null;
  /** 数据对应的本地日期——跨 0 点后首次写入会触发重新拉取 */
  day: string;
  words: number;
  activeMinutes: number;
  load: (bookId: number | null) => Promise<void>;
  record: (bookId: number, delta: number, countMinute: boolean) => Promise<void>;
}

export const useStats = create<StatsState>((set, get) => ({
  bookId: null,
  day: "",
  words: 0,
  activeMinutes: 0,

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, day: localDay(), words: 0, activeMinutes: 0 });
      return;
    }
    try {
      const t = await api.statsToday(bookId);
      set({ bookId, day: t.date, words: t.words, activeMinutes: t.active_minutes });
    } catch {
      set({ bookId, day: localDay(), words: 0, activeMinutes: 0 });
    }
  },

  record: async (bookId, delta, countMinute) => {
    // 换书或跨 0 点：先以服务端为准重取，再叠加本次差量
    if (get().bookId !== bookId || get().day !== localDay()) {
      await get().load(bookId);
    }
    set((s) =>
      s.bookId === bookId
        ? { words: s.words + delta, activeMinutes: s.activeMinutes + (countMinute ? 1 : 0) }
        : {},
    );
    try {
      await api.statsAdd(bookId, delta, countMinute);
    } catch {
      // 静默：统计失败不该打断写作
    }
  },
}));
