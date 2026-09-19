import { create } from "zustand";
import { api, type Foreshadow, type ForeshadowInput } from "../lib/tauri";

// M3-T10 伏笔 store：bookId 由面板从 workspace 取了传入，随当前书切换重载。
// 写操作成功后整表重取（每书伏笔个位数级，无需乐观更新）；
// 读失败静默（面板落到空态），写失败返回 false 由调用方决定反馈。

interface ForeshadowStore {
  bookId: number | null;
  list: Foreshadow[];
  load: (bookId: number | null) => Promise<void>;
  upsert: (input: ForeshadowInput) => Promise<boolean>;
  setStatus: (id: number, status: string, resolvedChapterId: number | null) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export const useForeshadow = create<ForeshadowStore>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, list: [] });
      return;
    }
    try {
      set({ bookId, list: await api.foreshadowsList(bookId) });
    } catch {
      set({ bookId, list: [] }); // 静默：面板显示空态
    }
  },

  upsert: async (input) => {
    try {
      await api.foreshadowUpsert(input);
    } catch {
      return false;
    }
    if (get().bookId === input.book_id) await get().load(input.book_id);
    return true;
  },

  setStatus: async (id, status, resolvedChapterId) => {
    try {
      await api.foreshadowSetStatus(id, status, resolvedChapterId);
    } catch {
      return false;
    }
    const bookId = get().bookId;
    if (bookId != null) await get().load(bookId);
    return true;
  },

  remove: async (id) => {
    try {
      await api.foreshadowDelete(id);
    } catch {
      return false;
    }
    const bookId = get().bookId;
    if (bookId != null) await get().load(bookId);
    return true;
  },
}));
