import { create } from "zustand";
import { api, type PlotBlock, type PlotBlockInput } from "../lib/tauri";

// M4 情节块 store（按书）：三态流转 idea → ready → used。
// reorder 拖拽后乐观应用（数组按新序写 sort_key 落库），失败整表重取回滚。

interface PlotBlocksStore {
  bookId: number | null;
  list: PlotBlock[];
  load: (bookId: number | null) => Promise<void>;
  upsert: (input: PlotBlockInput) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
  reorder: (ids: number[]) => Promise<void>;
}

export const usePlotBlocks = create<PlotBlocksStore>((set, get) => ({
  bookId: null,
  list: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, list: [] });
      return;
    }
    try {
      set({ bookId, list: await api.plotBlocksList(bookId) });
    } catch {
      set({ bookId, list: [] });
    }
  },

  upsert: async (input) => {
    try {
      await api.plotBlockUpsert(input);
    } catch {
      return false;
    }
    if (get().bookId === input.book_id) await get().load(input.book_id);
    return true;
  },

  remove: async (id) => {
    try {
      await api.plotBlockDelete(id);
    } catch {
      return false;
    }
    const bookId = get().bookId;
    if (bookId != null) await get().load(bookId);
    return true;
  },

  reorder: async (ids) => {
    const prev = get().list;
    // 乐观：按 ids 序重排本地（组语义排序在后端，这里只保证落库 sort_key）
    set({ list: ids.map((id) => prev.find((b) => b.id === id)).filter((b): b is PlotBlock => b != null) });
    try {
      await api.plotBlockReorder(ids);
    } catch {
      set({ list: prev }); // 失败回滚
      return;
    }
    const bookId = get().bookId;
    if (bookId != null) await get().load(bookId);
  },
}));
