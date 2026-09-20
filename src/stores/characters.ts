import { create } from "zustand";
import { api, type Character, type CharacterInput } from "../lib/tauri";

// M4 人物卡 store：与 foreshadow 同款——bookId 由面板从 workspace 取了传入，
// 随当前书切换重载；写成功后整表重取（每书人物卡几十级，无需乐观更新）；
// 读失败静默（面板落空态），写失败返回 false 由调用方反馈。

interface CharacterStore {
  bookId: number | null;
  list: Character[];
  load: (bookId: number | null) => Promise<void>;
  upsert: (input: CharacterInput) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export const useCharacters = create<CharacterStore>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, list: [] });
      return;
    }
    try {
      set({ bookId, list: await api.charactersList(bookId) });
    } catch {
      set({ bookId, list: [] }); // 静默：面板显示空态
    }
  },

  upsert: async (input) => {
    try {
      await api.characterUpsert(input);
    } catch {
      return false;
    }
    if (get().bookId === input.book_id) await get().load(input.book_id);
    return true;
  },

  remove: async (id) => {
    try {
      await api.characterDelete(id);
    } catch {
      return false;
    }
    const b = get().bookId;
    if (b != null) await get().load(b);
    return true;
  },
}));
