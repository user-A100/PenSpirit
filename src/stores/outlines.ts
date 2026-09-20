import { create } from "zustand";
import { api, type Outline, type OutlineInput } from "../lib/tauri";

// M4 大纲体系 store（与 characters/foreshadow 同款）：bookId 由面板从 workspace 取了传入，
// 随当前书切换重载。写操作成功后整表重取；写失败返回 false，冲突类错误（总纲已存在/
// 该章已有细纲）把后端 message 亮在面板上引导用户去编辑已有条目。

interface OutlinesStore {
  bookId: number | null;
  list: Outline[];
  load: (bookId: number | null) => Promise<void>;
  upsert: (input: OutlineInput) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: number) => Promise<boolean>;
}

export const useOutlinesStore = create<OutlinesStore>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, list: [] });
      return;
    }
    try {
      set({ bookId, list: await api.outlinesList(bookId) });
    } catch {
      set({ bookId, list: [] });
    }
  },

  upsert: async (input) => {
    try {
      await api.outlineUpsert(input);
    } catch (e) {
      return { ok: false, error: String(e).replace(/^.*?:\s*/, "") }; // 剥 "Error: " 前缀留中文 message
    }
    if (get().bookId === input.book_id) await get().load(input.book_id);
    return { ok: true };
  },

  remove: async (id) => {
    try {
      await api.outlineDelete(id);
    } catch {
      return false;
    }
    const bookId = get().bookId;
    if (bookId != null) await get().load(bookId);
    return true;
  },
}));
