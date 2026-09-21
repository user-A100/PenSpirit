import { create } from "zustand";
import { api, type CharacterRelation, type CharacterRelationInput } from "../lib/tauri";

// M5 图谱关系 store：与 characters 同款——bookId 由视图传入，
// 写成功后整表重取（每书关系几十级，无需乐观更新）；读失败静默空态。

interface RelationStore {
  bookId: number | null;
  list: CharacterRelation[];
  load: (bookId: number | null) => Promise<void>;
  upsert: (input: CharacterRelationInput) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export const useRelations = create<RelationStore>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, list: [] });
      return;
    }
    try {
      set({ bookId, list: await api.relationsList(bookId) });
    } catch {
      set({ bookId, list: [] }); // 静默：视图显示空态
    }
  },

  upsert: async (input) => {
    try {
      await api.relationUpsert(input);
    } catch {
      return false;
    }
    if (get().bookId === input.book_id) await get().load(input.book_id);
    return true;
  },

  remove: async (id) => {
    try {
      await api.relationDelete(id);
    } catch {
      return false;
    }
    const b = get().bookId;
    if (b != null) await get().load(b);
    return true;
  },
}));
