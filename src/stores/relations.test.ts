import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  bookId: 1 as number | null,
  rels: [] as Array<{
    id: number; book_id: number; source_id: number; target_id: number;
    relation_type: string; note: string;
  }>,
}));

vi.mock("../lib/tauri", () => ({
  api: {
    relationsList: vi.fn(async (bookId: number) =>
      db.rels.filter((r) => r.book_id === bookId)),
    relationUpsert: vi.fn(async (input: { id: number | null; book_id: number; source_id: number; target_id: number; relation_type: string; note: string }) => {
      if (input.id == null) {
        const rel = { ...input, id: Math.max(0, ...db.rels.map((r) => r.id)) + 1 };
        db.rels = [...db.rels, rel];
        return rel;
      }
      const rel = db.rels.find((r) => r.id === input.id)!;
      Object.assign(rel, input);
      return rel;
    }),
    relationDelete: vi.fn(async (id: number) => {
      db.rels = db.rels.filter((r) => r.id !== id);
    }),
  },
}));

import { api } from "../lib/tauri";
import { useRelations } from "./relations";

const rel = (id: number, over: Partial<{ source_id: number; target_id: number; book_id: number; relation_type: string; note: string }> = {}) => ({
  id, book_id: 1, source_id: 10, target_id: 20, relation_type: "配偶", note: "",
  created_at: "", updated_at: "", ...over,
});

describe("relations store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.bookId = 1;
    db.rels = [rel(1), rel(2, { source_id: 20, target_id: 30, relation_type: "仇敌" })];
    useRelations.setState({ bookId: null, list: [] });
  });

  it("load 填充当前书关系", async () => {
    await useRelations.getState().load(1);
    expect(api.relationsList).toHaveBeenCalledWith(1);
    expect(useRelations.getState().list).toHaveLength(2);
    expect(useRelations.getState().bookId).toBe(1);
  });

  it("load(null) 清空", async () => {
    await useRelations.getState().load(1);
    await useRelations.getState().load(null);
    expect(useRelations.getState().list).toHaveLength(0);
    expect(useRelations.getState().bookId).toBeNull();
  });

  it("读失败静默空态", async () => {
    vi.mocked(api.relationsList).mockRejectedValueOnce(new Error("boom"));
    await useRelations.getState().load(1);
    expect(useRelations.getState().list).toHaveLength(0);
  });

  it("upsert 成功后整表重取", async () => {
    await useRelations.getState().load(1);
    const ok = await useRelations.getState().upsert({
      id: null, book_id: 1, source_id: 30, target_id: 10, relation_type: "师徒", note: "",
    });
    expect(ok).toBe(true);
    expect(api.relationsList).toHaveBeenCalledTimes(2);
    expect(useRelations.getState().list).toHaveLength(3);
  });

  it("upsert 失败返回 false 不重取", async () => {
    await useRelations.getState().load(1);
    vi.mocked(api.relationUpsert).mockRejectedValueOnce(new Error("dup"));
    const ok = await useRelations.getState().upsert({
      id: null, book_id: 1, source_id: 1, target_id: 2, relation_type: "配偶", note: "",
    });
    expect(ok).toBe(false);
    expect(api.relationsList).toHaveBeenCalledTimes(1);
  });

  it("remove 成功后整表重取", async () => {
    await useRelations.getState().load(1);
    const ok = await useRelations.getState().remove(1);
    expect(ok).toBe(true);
    expect(api.relationDelete).toHaveBeenCalledWith(1);
    expect(useRelations.getState().list).toHaveLength(1);
  });
});
