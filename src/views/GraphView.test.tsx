import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  chars: [] as Array<{
    id: number; book_id: number; name: string; role: string; aliases: string;
    description: string; created_at: string; updated_at: string;
  }>,
  rels: [] as Array<{
    id: number; book_id: number; source_id: number; target_id: number;
    relation_type: string; note: string; created_at: string; updated_at: string;
  }>,
  loadChars: vi.fn(async () => {}),
  loadRels: vi.fn(async () => {}),
  upsertRel: vi.fn(async (_input: unknown) => true),
  removeRel: vi.fn(async (_id: number) => true),
}));

vi.mock("../stores/workspace", () => ({
  useWorkspace: (sel: (s: { currentBookId: number | null }) => unknown) => sel({ currentBookId: 1 }),
}));
vi.mock("../stores/characters", () => ({
  useCharacters: (sel: (s: { list: typeof state.chars; load: unknown }) => unknown) =>
    sel({ list: state.chars, load: state.loadChars }),
}));
vi.mock("../stores/relations", () => ({
  useRelations: (sel: (s: { list: typeof state.rels; load: unknown; upsert: unknown; remove: unknown }) => unknown) =>
    sel({ list: state.rels, load: state.loadRels, upsert: state.upsertRel, remove: state.removeRel }),
}));

import { GraphView } from "./GraphView";

const char = (id: number, name: string, role = "") => ({
  id, book_id: 1, name, role, aliases: "", description: "", created_at: "", updated_at: "",
});
const rel = (id: number, source_id: number, target_id: number, relation_type: string) => ({
  id, book_id: 1, source_id, target_id, relation_type, note: "", created_at: "", updated_at: "",
});

describe("GraphView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.chars = [char(1, "胡八一", "主角"), char(2, "胖子"), char(3, "Shirley杨")];
    state.rels = [];
  });

  it("进入视图随当前书加载角色与关系", async () => {
    render(<GraphView />);
    await waitFor(() => {
      expect(state.loadChars).toHaveBeenCalledWith(1);
      expect(state.loadRels).toHaveBeenCalledWith(1);
    });
  });

  it("三个 tab，默认家族树占位", () => {
    render(<GraphView />);
    expect(screen.getByTestId("graph-tab-tree")).toBeTruthy();
    expect(screen.getByTestId("graph-tab-network")).toBeTruthy();
    expect(screen.getByTestId("graph-tab-map")).toBeTruthy();
    expect(screen.getByTestId("graph-tree-placeholder")).toBeTruthy();
  });

  it("关系网络渲染角色节点与关系边", () => {
    state.rels = [rel(5, 1, 2, "挚友")];
    render(<GraphView />);
    fireEvent.click(screen.getByTestId("graph-tab-network"));
    expect(screen.getByTestId("rel-node-1")).toBeTruthy();
    expect(screen.getByTestId("rel-node-2")).toBeTruthy();
    expect(screen.getByTestId("rel-edge-5")).toBeTruthy();
  });

  it("点节点建关系：选对方 + 预设类型 + 保存", async () => {
    render(<GraphView />);
    fireEvent.click(screen.getByTestId("graph-tab-network"));
    fireEvent.click(screen.getByTestId("rel-node-1"));

    const modal = screen.getByTestId("relation-modal");
    expect(modal).toBeTruthy();

    fireEvent.click(screen.getByTestId("rel-preset-配偶"));
    fireEvent.change(screen.getByTestId("rel-target"), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId("rel-save"));

    await waitFor(() => {
      expect(state.upsertRel).toHaveBeenCalledWith({
        id: null, book_id: 1, source_id: 1, target_id: 2,
        relation_type: "配偶", note: "",
      });
    });
  });

  it("点边编辑关系：类型预填，可删除", () => {
    state.rels = [rel(5, 1, 2, "挚友")];
    render(<GraphView />);
    fireEvent.click(screen.getByTestId("graph-tab-network"));
    fireEvent.click(screen.getByTestId("rel-edge-5"));

    expect(screen.getByTestId("relation-modal")).toBeTruthy();
    expect((screen.getByTestId("rel-type-input") as HTMLInputElement).value).toBe("挚友");
    expect(screen.getByTestId("rel-delete")).toBeTruthy();

    fireEvent.click(screen.getByTestId("rel-delete"));
    expect(state.removeRel).toHaveBeenCalledWith(5);
  });

  it("空角色时关系网络落空态引导", () => {
    state.chars = [];
    render(<GraphView />);
    fireEvent.click(screen.getByTestId("graph-tab-network"));
    expect(screen.getByText(/还没有人物卡/)).toBeTruthy();
  });
});
