import { create } from "zustand";
import { api, DailyStat } from "../lib/tauri";

// M2-T11 今日写作字数。差量由 ChapterEditor 从 TipTap transaction 里算好传进来
// （粘贴/AI 采纳不计、跳变过大丢弃），这里负责乐观累加 + 落库。
//
// 统计是尽力而为：落库失败不打断写作，也不弹错（失败只影响徽章数字的准确度）。
//
// M3-T9 扩展：dailyGoal（日目标，settings KV "stats:dailyGoal"，"0"=关闭）与
// range（按日聚合的历史序列，bookId=null 全书聚合）。徽章的连续天数与统计
// 面板的全家桶指标都从 range 派生。

/** 本地日期 YYYY-MM-DD（与后端 date('now','localtime') 同一口径） */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 本地分钟串，用于「同一分钟只记一次活跃」 */
export function localMinute(d = new Date()): string {
  return `${localDay(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 日目标在 settings KV 里的键；值是十进制数字符串，"0"=关闭 */
export const DAILY_GOAL_KEY = "stats:dailyGoal";

/** 拉全量历史：stats_range 只返回有记录的日子，days 给足即等价于全部（累计/最长连续都需要全量） */
export const HISTORY_DAYS = 36500;

interface StatsState {
  bookId: number | null;
  /** 数据对应的本地日期——跨 0 点后首次写入会触发重新拉取 */
  day: string;
  words: number;
  activeMinutes: number;
  /** 日目标字数；0 = 关闭 */
  dailyGoal: number;
  /** 按日聚合的历史（全书）；只含有记录的日子，图表槽位由 lastNDays 补齐 */
  range: DailyStat[];
  load: (bookId: number | null) => Promise<void>;
  record: (bookId: number, delta: number, countMinute: boolean) => Promise<void>;
  loadDailyGoal: () => Promise<void>;
  setDailyGoal: (n: number) => Promise<void>;
  loadRange: (days: number) => Promise<void>;
}

export const useStats = create<StatsState>((set, get) => ({
  bookId: null,
  day: "",
  words: 0,
  activeMinutes: 0,
  dailyGoal: 0,
  range: [],

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

  loadDailyGoal: async () => {
    try {
      const raw = await api.settingGet(DAILY_GOAL_KEY);
      const n = Math.max(0, Math.floor(Number(raw ?? "0") || 0));
      set({ dailyGoal: Number.isFinite(n) ? n : 0 });
    } catch {
      // 读不到就维持现状（默认 0=关闭）
    }
  },

  setDailyGoal: async (n) => {
    const v = Math.max(0, Math.floor(n) || 0);
    set({ dailyGoal: v });
    try {
      await api.settingSet(DAILY_GOAL_KEY, String(v));
    } catch {
      // 静默：目标保存失败只影响下次启动的回显
    }
  },

  loadRange: async (days) => {
    try {
      set({ range: await api.statsRange(days, null) });
    } catch {
      // 静默：图表维持旧数据
    }
  },
}));
