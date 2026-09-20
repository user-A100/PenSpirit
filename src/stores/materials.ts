import { create } from "zustand";
import { api, type Material, type MaterialInput } from "../lib/tauri";

// M4 素材库 store：素材全局不分书。query 由视图搜索框传入，防抖由视图负责。
// 写操作成功后按当前 query 重取（保持搜索态一致）。

interface MaterialsStore {
  query: string;
  list: Material[];
  load: (query: string) => Promise<void>;
  upsert: (input: MaterialInput) => Promise<boolean>;
  remove: (id: number) => Promise<boolean>;
}

export const useMaterials = create<MaterialsStore>((set, get) => ({
  query: "",
  list: [],

  load: async (query) => {
    try {
      set({ query, list: await api.materialsList(query) });
    } catch {
      set({ query, list: [] });
    }
  },

  upsert: async (input) => {
    try {
      await api.materialUpsert(input);
    } catch {
      return false;
    }
    await get().load(get().query);
    return true;
  },

  remove: async (id) => {
    try {
      await api.materialDelete(id);
    } catch {
      return false;
    }
    await get().load(get().query);
    return true;
  },
}));
