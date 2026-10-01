import { describe, expect, it } from "vitest";
import type { ChapterMeta } from "./tauri";
import { indent, kindsOf, moveNodes, nudgeTree, outdent, reorderSiblings, toItems, treeDropTarget, treeOrder, visibleRows, type TreeItem } from "./binderTree";

// 序章(1) / 第一卷(10)[甲(2), 乙(3)] / 第二卷(20)[丙(4)] / 尾声(5)
const n = (id: number, title: string, sort: number, kind: "text" | "folder" = "text", parent: number | null = null): ChapterMeta => ({
  id, book_id: 1, file_path: "", title, sort_key: sort, word_count: 0, created_at: "", updated_at: "",
  synopsis: "", label_id: null, status_id: null, target_words: null, kind, parent_id: parent,
});
const NODES = [n(5, "尾声", 6), n(20, "第二卷", 4, "folder"), n(1, "序章", 0), n(10, "第一卷", 1, "folder"), n(3, "乙", 3, "text", 10), n(2, "甲", 2, "text", 10), n(4, "丙", 5, "text", 20)];
const order = treeOrder(NODES);
const items = toItems(order);
const kinds = kindsOf(NODES);
const ids = (xs: TreeItem[] | null) => xs?.map((x) => (x.parent_id == null ? `${x.id}` : `${x.parent_id}>${x.id}`)).join(" ");

describe("binderTree", () => {
  it("treeOrder：顶层按 sort_key，卷后紧跟子章", () => {
    expect(order.map((x) => x.title)).toEqual(["序章", "第一卷", "甲", "乙", "第二卷", "丙", "尾声"]);
    expect(ids(items)).toBe("1 10 10>2 10>3 20 20>4 5");
  });

  it("visibleRows：折叠隐藏子章；hoist 只看卷内；过滤保留祖先并淡化", () => {
    expect(visibleRows(NODES).map((r) => `${r.depth}${r.node.title}`)).toEqual(["0序章", "0第一卷", "1甲", "1乙", "0第二卷", "1丙", "0尾声"]);
    expect(visibleRows(NODES, { collapsed: new Set([10]) }).map((r) => r.node.title)).toEqual(["序章", "第一卷", "第二卷", "丙", "尾声"]);
    expect(visibleRows(NODES).find((r) => r.node.id === 10)?.childCount).toBe(2);
    expect(visibleRows(NODES, { hoist: 10 }).map((r) => `${r.depth}${r.node.title}`)).toEqual(["0甲", "0乙"]);
    const f = visibleRows(NODES, { collapsed: new Set([10]), match: (x) => x.title === "乙" });
    expect(f.map((r) => `${r.node.title}${r.dim ? "·淡" : ""}`)).toEqual(["第一卷·淡", "乙"]);
  });

  it("moveNodes：章拖进卷 / 卷内章前后 / 顶层；卷整块移动；非法落点返回 null", () => {
    expect(ids(moveNodes(items, kinds, [5], { kind: "into", ref: 10 }))).toBe("1 10 10>2 10>3 10>5 20 20>4");
    expect(ids(moveNodes(items, kinds, [4], { kind: "before", ref: 3 }))).toBe("1 10 10>2 10>4 10>3 20 5");
    expect(ids(moveNodes(items, kinds, [2], { kind: "after", ref: 20 }))).toBe("1 10 10>3 20 20>4 2 5");
    // 多选聚拢（保持相对顺序）；落在卷内章之后 = 成为该卷的同级
    expect(ids(moveNodes(items, kinds, [5, 1], { kind: "after", ref: 4 }))).toBe("10 10>2 10>3 20 20>4 20>1 20>5");
    expect(ids(moveNodes(items, kinds, [5, 1], { kind: "after", ref: 20 }))).toBe("10 10>2 10>3 20 20>4 1 5");
    // 卷整块移动；含卷的选区落在卷内章上 → 落到整卷之前
    expect(ids(moveNodes(items, kinds, [20], { kind: "before", ref: 1 }))).toBe("20 20>4 1 10 10>2 10>3 5");
    expect(ids(moveNodes(items, kinds, [20], { kind: "before", ref: 3 }))).toBe("1 20 20>4 10 10>2 10>3 5");
    expect(moveNodes(items, kinds, [20], { kind: "into", ref: 10 })).toBeNull();
    expect(moveNodes(items, kinds, [10], { kind: "before", ref: 2 })).toBeNull();
    expect(moveNodes(items, kinds, [2], { kind: "before", ref: 3 })).toBeNull();
  });

  it("indent / outdent：并入前面的卷 / 移出到卷后", () => {
    expect(ids(indent(items, kinds, [5]))).toBe("1 10 10>2 10>3 20 20>4 20>5");
    expect(indent(items, kinds, [1])).toBeNull();
    expect(ids(outdent(items, kinds, [2]))).toBe("1 10 10>3 2 20 20>4 5");
  });

  it("nudgeTree：同级交换，卷算一个单位，出不了所属卷", () => {
    expect(ids(nudgeTree(items, kinds, [3], -1))).toBe("1 10 10>3 10>2 20 20>4 5");
    expect(nudgeTree(items, kinds, [2], -1)).toBeNull();
    expect(ids(nudgeTree(items, kinds, [10], 1))).toBe("1 20 20>4 10 10>2 10>3 5");
    expect(ids(reorderSiblings(items, 10, [3, 2]))).toBe("1 10 10>3 10>2 20 20>4 5");
  });

  it("treeDropTarget：章行上下半 before/after；卷行上 30% before 其余 into；含卷时卷行也分上下半", () => {
    const rows = [
      { id: 1, kind: "text" as const, depth: 0 as const, top: 0, bottom: 32 },
      { id: 10, kind: "folder" as const, depth: 0 as const, top: 32, bottom: 64 },
    ];
    expect(treeDropTarget(rows, 10, false)).toEqual({ kind: "before", ref: 1 });
    expect(treeDropTarget(rows, 20, false)).toEqual({ kind: "after", ref: 1 });
    expect(treeDropTarget(rows, 35, false)).toEqual({ kind: "before", ref: 10 });
    expect(treeDropTarget(rows, 50, false)).toEqual({ kind: "into", ref: 10 });
    expect(treeDropTarget(rows, 50, true)).toEqual({ kind: "after", ref: 10 });
    expect(treeDropTarget(rows, 90, false)).toEqual({ kind: "after", ref: 10 });
  });
});
