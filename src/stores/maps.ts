import { create } from "zustand";
import { api, type Place, type PlaceInput, type WorldMap } from "../lib/tauri";

// M5 图谱地图 store：整表重取；activeMapId 随 load 自动回落到首图，
// 选中图时按需拉取其地点；删除当前图后回落到剩余首图。

interface MapsStore {
  bookId: number | null;
  maps: WorldMap[];
  activeMapId: number | null;
  places: Place[];
  load: (bookId: number | null) => Promise<void>;
  select: (mapId: number | null) => Promise<void>;
  importMap: (name: string, srcPath: string) => Promise<boolean>;
  rename: (id: number, name: string) => Promise<boolean>;
  removeMap: (id: number) => Promise<boolean>;
  placeUpsert: (input: PlaceInput) => Promise<boolean>;
  placeRemove: (id: number) => Promise<boolean>;
}

export const useMaps = create<MapsStore>((set, get) => ({
  bookId: null,
  maps: [],
  activeMapId: null,
  places: [],

  load: async (bookId) => {
    if (bookId == null) {
      set({ bookId: null, maps: [], activeMapId: null, places: [] });
      return;
    }
    let maps: WorldMap[] = [];
    try {
      maps = await api.mapsList(bookId);
    } catch {
      maps = []; // 静默：视图显示空态
    }
    set({ bookId, maps });
    const active = maps.find((m) => m.id === get().activeMapId) ?? maps[0];
    await get().select(active?.id ?? null);
  },

  select: async (mapId) => {
    set({ activeMapId: mapId, places: [] });
    if (mapId == null) return;
    try {
      set({ places: await api.placesList(mapId) });
    } catch {
      set({ places: [] });
    }
  },

  importMap: async (name, srcPath) => {
    const b = get().bookId;
    if (b == null) return false;
    let imported: WorldMap;
    try {
      imported = await api.mapImport(b, name, srcPath);
    } catch {
      return false;
    }
    await get().load(b);
    await get().select(imported.id);
    return true;
  },

  rename: async (id, name) => {
    try {
      await api.mapRename(id, name);
    } catch {
      return false;
    }
    const b = get().bookId;
    if (b != null) await get().load(b);
    return true;
  },

  removeMap: async (id) => {
    try {
      await api.mapDelete(id);
    } catch {
      return false;
    }
    const b = get().bookId;
    if (b != null) {
      await get().load(b);
      if (get().activeMapId === id) {
        await get().select(get().maps[0]?.id ?? null);
      }
    }
    return true;
  },

  placeUpsert: async (input) => {
    try {
      await api.placeUpsert(input);
    } catch {
      return false;
    }
    const active = get().activeMapId;
    if (active != null) await get().select(active);
    return true;
  },

  placeRemove: async (id) => {
    try {
      await api.placeDelete(id);
    } catch {
      return false;
    }
    const active = get().activeMapId;
    if (active != null) await get().select(active);
    return true;
  },
}));
