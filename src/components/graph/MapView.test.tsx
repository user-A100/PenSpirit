import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  maps: [] as Array<{ id: number; book_id: number; name: string; path: string; created_at: string; updated_at: string }>,
  activeMapId: null as number | null,
  places: [] as Array<{
    id: number; book_id: number; map_id: number; name: string; description: string;
    linked_character_ids: string; x: number; y: number; created_at: string; updated_at: string;
  }>,
  chars: [] as Array<{ id: number; book_id: number; name: string; role: string; aliases: string; description: string; created_at: string; updated_at: string }>,
  select: vi.fn(async (_id: number | null) => {}),
  importMap: vi.fn(async (_name: string, _path: string) => true),
  rename: vi.fn(async (_id: number, _name: string) => true),
  removeMap: vi.fn(async (_id: number) => true),
  placeUpsert: vi.fn(async (_input: unknown) => true),
  placeRemove: vi.fn(async (_id: number) => true),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://mock/${p}`,
}));
vi.mock("../../stores/workspace", () => ({
  useWorkspace: (sel: (s: { currentBookId: number | null }) => unknown) => sel({ currentBookId: 1 }),
}));
vi.mock("../../stores/maps", () => ({
  useMaps: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      bookId: 1,
      maps: state.maps,
      activeMapId: state.activeMapId,
      places: state.places,
      load: vi.fn(async () => {}),
      select: state.select,
      importMap: state.importMap,
      rename: state.rename,
      removeMap: state.removeMap,
      placeUpsert: state.placeUpsert,
      placeRemove: state.placeRemove,
    }),
}));
vi.mock("../../stores/characters", () => ({
  useCharacters: (sel: (s: { list: typeof state.chars }) => unknown) => sel({ list: state.chars }),
}));

import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { MapView } from "./MapView";

const map1 = {
  id: 7, book_id: 1, name: "九州图", path: "C:\\maps\\jiuzhou.png",
  created_at: "", updated_at: "",
};
const pin = (id: number, over: Partial<{ x: number; y: number; name: string }> = {}) => ({
  id, book_id: 1, map_id: 7, name: `地点${id}`, description: "", linked_character_ids: "",
  x: 10, y: 20, created_at: "", updated_at: "", ...over,
});

describe("MapView", () => {
  beforeAll(() => {
    // happy-dom 不做真实布局：统一 mock 出 1000x500 的矩形供百分比换算
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500,
          width: 1000, height: 500, toJSON: () => ({}),
        }) as DOMRect,
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(openFileDialog).mockReset();
    state.maps = [map1];
    state.activeMapId = 7;
    state.places = [];
    state.chars = [];
  });

  it("无地图时空态引导，点导入弹文件框并调用导入", async () => {
    state.maps = [];
    state.activeMapId = null;
    render(<MapView />);
    expect(screen.getByText(/还没有世界地图/)).toBeTruthy();

    vi.mocked(openFileDialog).mockResolvedValue("C:\\maps\\x.png");
    fireEvent.click(screen.getByTestId("map-import"));
    await waitFor(() => {
      expect(state.importMap).toHaveBeenCalledWith("x", "C:\\maps\\x.png");
    });
  });

  it("渲染底图与地点 pin，点 pin 开详情，改名保存回写", async () => {
    state.places = [pin(3, { x: 25, y: 40, name: "青云山" })];
    const { container } = render(<MapView />);
    const img = container.querySelector("img");
    expect(img?.getAttribute("src")).toBe("asset://mock/C:\\maps\\jiuzhou.png");
    expect(screen.getByTestId("map-pin-3")).toBeTruthy();

    fireEvent.pointerDown(screen.getByTestId("map-pin-3"));
    fireEvent.pointerUp(screen.getByTestId("map-pin-3"));
    expect(screen.getByTestId("place-modal")).toBeTruthy();
    expect((screen.getByTestId("place-name") as HTMLInputElement).value).toBe("青云山");

    fireEvent.change(screen.getByTestId("place-name"), { target: { value: "青云山·北麓" } });
    fireEvent.click(screen.getByTestId("place-save"));
    await waitFor(() => {
      expect(state.placeUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, map_id: 7, name: "青云山·北麓", x: 25, y: 40 }),
      );
    });
  });

  it("双击图面按百分比坐标新建地点", async () => {
    render(<MapView />);
    fireEvent.doubleClick(screen.getByTestId("map-surface"), { clientX: 500, clientY: 250 });
    expect(screen.getByTestId("place-modal")).toBeTruthy();

    fireEvent.change(screen.getByTestId("place-name"), { target: { value: "落霞镇" } });
    fireEvent.click(screen.getByTestId("place-save"));
    await waitFor(() => {
      expect(state.placeUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, map_id: 7, name: "落霞镇", x: 50, y: 50 }),
      );
    });
  });

  it("拖动 pin 松手即按新坐标落库", async () => {
    state.places = [pin(3, { x: 10, y: 20 })];
    render(<MapView />);
    const p = screen.getByTestId("map-pin-3");
    fireEvent.pointerDown(p);
    fireEvent.pointerMove(p, { clientX: 600, clientY: 300 });
    fireEvent.pointerUp(p);
    await waitFor(() => {
      expect(state.placeUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 3, x: 60, y: 60 }),
      );
    });
  });

  it("重命名与删除地图走确认", async () => {
    render(<MapView />);

    fireEvent.click(screen.getByTestId("map-rename-7"));
    fireEvent.change(screen.getByTestId("map-rename-input"), { target: { value: "九洲全图" } });
    fireEvent.click(screen.getByTestId("map-rename-save"));
    await waitFor(() => expect(state.rename).toHaveBeenCalledWith(7, "九洲全图"));

    (window as unknown as { confirm: unknown }).confirm = vi.fn(() => true);
    fireEvent.click(screen.getByTestId("map-delete-7"));
    await waitFor(() => expect(state.removeMap).toHaveBeenCalledWith(7));
  });
});
