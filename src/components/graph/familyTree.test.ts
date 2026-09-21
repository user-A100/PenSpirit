import { describe, expect, it } from "vitest";
import type { Character, CharacterRelation } from "../../lib/tauri";
import { NODE_H, NODE_W, layoutFamilyTree } from "./familyTree";

const char = (id: number, name = `角色${id}`): Character => ({
  id,
  book_id: 1,
  name,
  role: "",
  aliases: "",
  description: "",
  created_at: "",
  updated_at: "",
});
const rel = (
  id: number,
  source_id: number,
  target_id: number,
  relation_type: string,
): CharacterRelation => ({
  id,
  book_id: 1,
  source_id,
  target_id,
  relation_type,
  note: "",
  created_at: "",
  updated_at: "",
});

const nodeOf = (l: ReturnType<typeof layoutFamilyTree>, id: number) => {
  const n = l.nodes.find((n) => n.char.id === id);
  expect(n, `节点 ${id} 应有坐标`).toBeTruthy();
  return n!;
};

describe("layoutFamilyTree", () => {
  it("空角色返回空布局不抛错", () => {
    const l = layoutFamilyTree([], []);
    expect(l.nodes).toHaveLength(0);
    expect(l.width).toBe(0);
  });

  it("三代直系：世代递增、单链共轴、父母边从上到下", () => {
    const l = layoutFamilyTree(
      [char(1), char(2), char(3)],
      [rel(1, 1, 2, "父母"), rel(2, 2, 3, "父母")],
    );
    const a = nodeOf(l, 1);
    const b = nodeOf(l, 2);
    const c = nodeOf(l, 3);
    expect(a.gen).toBe(0);
    expect(b.gen).toBe(1);
    expect(c.gen).toBe(2);
    expect(b.y).toBeGreaterThan(a.y);
    expect(c.y).toBeGreaterThan(b.y);
    // 单链无分支：三代同一纵轴
    expect(a.x).toBe(b.x);
    expect(b.x).toBe(c.x);

    const pe = l.edges.filter((e) => e.kind === "parent");
    expect(pe).toHaveLength(2);
    expect(pe[0].x1).toBe(pe[0].x2);
    expect(pe[0].y1).toBe(a.y + NODE_H);
    expect(pe[0].y2).toBe(b.y);
  });

  it("「子女」关系在布局时反转方向", () => {
    // B(2) 是 A(1) 的子女 → 仍是 A gen0 / B gen1
    const l = layoutFamilyTree([char(1), char(2)], [rel(1, 2, 1, "子女")]);
    expect(nodeOf(l, 1).gen).toBe(0);
    expect(nodeOf(l, 2).gen).toBe(1);
    expect(l.edges.some((e) => e.kind === "parent")).toBe(true);
    expect(l.islandIds).toHaveLength(0);
  });

  it("夫妻并排同代，子女居中挂在夫妻中点下方", () => {
    const l = layoutFamilyTree(
      [char(1), char(2), char(3)],
      [rel(1, 1, 2, "配偶"), rel(2, 1, 3, "父母")],
    );
    const a = nodeOf(l, 1);
    const b = nodeOf(l, 2);
    const c = nodeOf(l, 3);
    // 夫妻并排：相邻 + 同代
    expect(b.x).toBe(a.x + NODE_W + 28);
    expect(a.y).toBe(b.y);
    expect(a.gen).toBe(0);
    expect(c.gen).toBe(1);
    // 子女中线 = 夫妻中心中点
    const coupleMid = (a.x + NODE_W / 2 + b.x + NODE_W / 2) / 2;
    expect(Math.abs(c.x + NODE_W / 2 - coupleMid)).toBeLessThan(0.5);

    const se = l.edges.find((e) => e.kind === "spouse");
    expect(se).toBeTruthy();
  });

  it("配偶边去重：双向登记只画一条", () => {
    const l = layoutFamilyTree(
      [char(1), char(2)],
      [rel(1, 1, 2, "配偶"), rel(2, 2, 1, "配偶")],
    );
    expect(l.edges.filter((e) => e.kind === "spouse")).toHaveLength(1);
  });

  it("两个家族多根左右排开互不重叠", () => {
    const l = layoutFamilyTree(
      [char(1), char(2), char(3), char(4)],
      [rel(1, 1, 2, "父母"), rel(2, 3, 4, "父母")],
    );
    const left = l.nodes.filter((n) => n.char.id <= 2);
    const right = l.nodes.filter((n) => n.char.id >= 3);
    const leftMaxX = Math.max(...left.map((n) => n.x + NODE_W));
    const rightMinX = Math.min(...right.map((n) => n.x));
    expect(rightMinX).toBeGreaterThan(leftMaxX);
    // 两根同代同高
    expect(nodeOf(l, 1).y).toBe(nodeOf(l, 3).y);
  });

  it("互为父母成环：归孤岛行且不抛错，其余角色正常", () => {
    // 1↔2 互为父母成环；3 是 4 的正常父亲
    const l = layoutFamilyTree(
      [char(1), char(2), char(3), char(4)],
      [rel(1, 1, 2, "父母"), rel(2, 2, 1, "父母"), rel(3, 3, 4, "父母")],
    );
    expect([...l.islandIds].sort()).toEqual([1, 2]);
    // 孤岛仍给出坐标（底部孤岛行）
    const i1 = nodeOf(l, 1);
    const i2 = nodeOf(l, 2);
    expect(i1.y).toBe(i2.y);
    // 正常家族不受影响
    expect(nodeOf(l, 3).gen).toBe(0);
    expect(nodeOf(l, 4).gen).toBe(1);
    expect(l.strayIds).toHaveLength(0);
  });

  it("无任何家族边的角色进未入谱行", () => {
    const l = layoutFamilyTree([char(1), char(2)], []);
    expect(l.strayIds).toEqual([1, 2]);
    const a = nodeOf(l, 1);
    const b = nodeOf(l, 2);
    expect(a.y).toBe(b.y);
    expect(b.x).toBe(a.x + NODE_W + 28);
    expect(l.edges).toHaveLength(0);
  });

  it("仅师徒关系不入谱（视为未入谱）", () => {
    const l = layoutFamilyTree([char(1), char(2)], [rel(1, 1, 2, "师徒")]);
    expect([...l.strayIds].sort()).toEqual([1, 2]);
    expect(l.edges).toHaveLength(0);
    expect(l.islandIds).toHaveLength(0);
  });

  it("兄弟关系同代展示，不产生世代边", () => {
    const l = layoutFamilyTree([char(1), char(2)], [rel(1, 1, 2, "兄弟")]);
    expect(l.strayIds).toHaveLength(0); // 兄弟是家族边，不入未谱行
    expect(nodeOf(l, 1).gen).toBe(0);
    expect(nodeOf(l, 2).gen).toBe(0);
    expect(nodeOf(l, 1).y).toBe(nodeOf(l, 2).y);
    expect(l.edges).toHaveLength(0);
  });

  it("引用不存在角色的关系被忽略", () => {
    const l = layoutFamilyTree([char(1)], [rel(1, 1, 99, "父母")]);
    expect(l.edges).toHaveLength(0);
    expect(l.strayIds).toEqual([1]);
  });
});
