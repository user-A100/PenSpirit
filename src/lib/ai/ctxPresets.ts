import { create } from "zustand";
import { kvGet, kvSet } from "../kv";
import type { MentionItem } from "../../stores/chat";

// 上下文包（阶段 2C）：把一组「这轮要带的上下文」存成有名字的包——@ 引用、关闭的槽位、手选的写作规则，
// 外加模式 / 长度 / 温度。包是**常驻**的：选中后每一轮都带上（与本轮临时的引用合并），直到取消。
// 每书各存一份（settings「ctx_presets:{bookId}」，删书时清掉）。

export interface CtxPreset {
  id: string;
  name: string;
  mentions: MentionItem[];
  disabledSlots: string[];
  rules: number[];
  mode: "write" | "discuss" | null;
  targetChars: number | null;
  temperature: number | null;
}

const key = (bookId: number) => `ctx_presets:${bookId}`;

interface CtxPresetsState {
  bookId: number | null;
  list: CtxPreset[];
  /** 当前常驻的包 */
  active: CtxPreset | null;
  load: (bookId: number | null) => Promise<void>;
  save: (p: CtxPreset) => Promise<void>;
  remove: (id: string) => Promise<void>;
  setActive: (p: CtxPreset | null) => void;
}

export const useCtxPresets = create<CtxPresetsState>((set, get) => ({
  bookId: null,
  list: [],
  active: null,
  load: async (bookId) => {
    set({ bookId, active: null, list: [] });
    if (bookId == null) return;
    try {
      const v = await kvGet<CtxPreset[]>(key(bookId));
      if (get().bookId === bookId) set({ list: Array.isArray(v) ? v : [] });
    } catch {
      // 读不到当作没有
    }
  },
  save: async (p) => {
    const bookId = get().bookId;
    if (bookId == null) return;
    const cur = get().list;
    const list = cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p];
    set({ list });
    await kvSet(key(bookId), list);
  },
  remove: async (id) => {
    const bookId = get().bookId;
    if (bookId == null) return;
    const list = get().list.filter((x) => x.id !== id);
    set({ list, active: get().active?.id === id ? null : get().active });
    await kvSet(key(bookId), list);
  },
  setActive: (active) => set({ active }),
}));
