import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bookId: 1 as number | null,
  maps: [] as Array<{ id: number; book_id: number; name: string; path: string }>,
  places: [] as Array<{ id: number; map_id: number; name: string; x: number; y: number }>,
}));

vi.mock("../lib/tauri", () => ({
  api: {
    mapsList: vi.fn(async (bookId: number) => db.maps.filter((m) => m.book_id === bookId)),
    mapImport: vi.fn(async (bookId: number, name: string, _srcPath: string) => {
      const m = {
        id: Math.max(0, ...db.maps.map((x) => x.id)) + 1,
        book_id: bookId, name, path: `C:/fake/${name}.png`, created_at: "", updated_at: "",
      };
      db.maps = [...db.maps, m];
      return m;
    }),
    mapRename: vi.fn(async (id: number, name: string) => {
      const m = db.maps.find((x) => x.id === id)!;
      m.name = name;
      return m;
    }),
    mapDelete: vi.fn(async (id: number) => {
      db.maps = db.maps.filter((m) => m.id !== id);
      db.places = db.places.filter((p) => p.map_id !== id);
    }),
    placesList: vi.fn(async (mapId: number) => db.places.filter((p) => p.map_id === mapId)),
    placeUpsert: vi.fn(async (input: { id: number | null; map_id: number; name: string; x: number; y: number }) => {
      if (input.id == null) {
        const p = { ...input, id: Math.max(0, ...db.places.map((x) => x.id)) + 1 };
        db.places = [...db.places, p];
        return p;
      }
      const p = db.places.find((x) => x.id === input.id)!;
      Object.assign(p, input);
      return p;
    }),
    placeDelete: vi.fn(async (id: number) => {
      db.places = db.places.filter((p) => p.id !== id);
    }),
  },
}));

import { api, type WorldMap } from "../lib/tauri";
import { useMaps } from "./maps";

const map = (id: number, book_id = 1): WorldMap =>
  ({ id, book_id, name: `图${id}`, path: `C:/fake/${id}.png`, created_at: "", updated_at: "" });
const pin = (id: number, map_id: number) => ({ id, map_id, name: `点${id}`, x: 10, y: 20 });

describe("maps store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.bookId = 1;
    db.maps = [map(1), map(2)];
    db.places = [pin(1, 1), pin(2, 2)];
    useMaps.setState({ bookId: null, maps: [], activeMapId: null, places: [] });
  });

  it("load 填充地图并自动选中首图、拉取其地点", async () => {
    await useMaps.getState().load(1);
    expect(api.mapsList).toHaveBeenCalledWith(1);
    expect(useMaps.getState().maps).toHaveLength(2);
    expect(useMaps.getState().activeMapId).toBe(1);
    expect(api.placesList).toHaveBeenCalledWith(1);
    expect(useMaps.getState().places).toHaveLength(1);
  });

  it("load 保留仍存在的选中图", async () => {
    await useMaps.getState().load(1);
    await useMaps.getState().select(2);
    expect(api.placesList).toHaveBeenLastCalledWith(2);
    await useMaps.getState().load(1);
    expect(useMaps.getState().activeMapId).toBe(2);
    expect(useMaps.getState().places).toHaveLength(1);
  });

  it("load(null) 全清", async () => {
    await useMaps.getState().load(1);
    await useMaps.getState().load(null);
    expect(useMaps.getState().maps).toHaveLength(0);
    expect(useMaps.getState().activeMapId).toBeNull();
    expect(useMaps.getState().places).toHaveLength(0);
  });

  it("importMap 落库后重取并选中新图", async () => {
    await useMaps.getState().load(1);
    vi.clearAllMocks();
    const ok = await useMaps.getState().importMap("新大陆", "C:/src/x.png");
    expect(ok).toBe(true);
    expect(api.mapImport).toHaveBeenCalledWith(1, "新大陆", "C:/src/x.png");
    expect(useMaps.getState().maps).toHaveLength(3);
    expect(useMaps.getState().activeMapId).toBe(3);
  });

  it("无书时 importMap 拒绝", async () => {
    useMaps.setState({ bookId: null });
    const ok = await useMaps.getState().importMap("新大陆", "C:/src/x.png");
    expect(ok).toBe(false);
    expect(api.mapImport).not.toHaveBeenCalled();
  });

  it("removeMap 删当前图后回落首图", async () => {
    await useMaps.getState().load(1);
    await useMaps.getState().select(2);
    const ok = await useMaps.getState().removeMap(2);
    expect(ok).toBe(true);
    expect(useMaps.getState().maps).toHaveLength(1);
    expect(useMaps.getState().activeMapId).toBe(1);
  });

  it("placeUpsert 落库后重取当前图地点", async () => {
    await useMaps.getState().load(1);
    const ok = await useMaps.getState().placeUpsert({
      id: null, map_id: 1, name: "青云山", description: "", linked_character_ids: "", x: 30, y: 40,
    });
    expect(ok).toBe(true);
    expect(useMaps.getState().places).toHaveLength(2);
  });

  it("placeRemove 后重取", async () => {
    await useMaps.getState().load(1);
    const ok = await useMaps.getState().placeRemove(1);
    expect(ok).toBe(true);
    expect(useMaps.getState().places).toHaveLength(0);
  });

  it("读失败静默空态", async () => {
    vi.mocked(api.mapsList).mockRejectedValueOnce(new Error("boom"));
    await useMaps.getState().load(1);
    expect(useMaps.getState().maps).toHaveLength(0);
    expect(useMaps.getState().activeMapId).toBeNull();
  });
});
