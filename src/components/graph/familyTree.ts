import type { Character, CharacterRelation } from "../../lib/tauri";

// 家族树布局（纯函数，vitest 直测不碰 DOM）。
// 规则：世代 = 父母→子女方向边取最深（「子女」关系在归一化时反转）；
// 配偶经 union-find 并成单元、同代并排；单元以子女跨度为中轴居中；
// 多根按角色创建顺序左右排开。「兄弟」是家族语义色但无世代效果（通常共父母）。
// 兜底：互为父母等成环者世代不收敛 → islandIds（孤岛行，前端警示）；
// 无任何家族边（含仅师徒/仇敌等）→ strayIds（未入谱行）。绝不抛错。

export const NODE_W = 110;
export const NODE_H = 44;
const GAP_X = 28; // 单元内成员间距
const GAP_UNIT = 40; // 单元/根之间距
const LEVEL_H = 130; // 世代层高
const PAD = 40;

export interface FamilyNode {
  char: Character;
  x: number; // 左上角
  y: number;
  gen: number;
}
export interface FamilyEdge {
  x1: number; y1: number; x2: number; y2: number;
  kind: "parent" | "spouse";
}
export interface FamilyLayout {
  nodes: FamilyNode[];
  edges: FamilyEdge[];
  /** 世代不收敛（环）的角色，前端警示展示 */
  islandIds: number[];
  /** 无任何家族边的角色（未入谱行） */
  strayIds: number[];
  width: number;
  height: number;
}

export function layoutFamilyTree(chars: Character[], rels: CharacterRelation[]): FamilyLayout {
  const empty = { nodes: [], edges: [], islandIds: [] as number[], strayIds: [] as number[], width: 0, height: 0 };
  if (chars.length === 0) return empty;

  const byId = new Map(chars.map((c) => [c.id, c]));
  const idx = new Map(chars.map((c, i) => [c.id, i]));

  // ---- 1. 归一化家族边 ----
  const parentEdges: Array<{ p: number; c: number }> = [];
  const spousePairs: Array<[number, number]> = [];
  const seenSpouse = new Set<string>();
  const hasFamilyEdge = new Set<number>();
  for (const r of rels) {
    if (!byId.has(r.source_id) || !byId.has(r.target_id)) continue;
    const t = r.relation_type.trim();
    if (t === "父母") parentEdges.push({ p: r.source_id, c: r.target_id });
    else if (t === "子女") parentEdges.push({ p: r.target_id, c: r.source_id });
    else if (t === "配偶") {
      const key = [r.source_id, r.target_id].sort((a, b) => a - b).join("-");
      if (!seenSpouse.has(key)) {
        seenSpouse.add(key);
        spousePairs.push([r.source_id, r.target_id]);
      }
    } else if (t === "兄弟") {
      // 家族语义边（不算未入谱），但无世代/结构效果
    } else continue;
    hasFamilyEdge.add(r.source_id);
    hasFamilyEdge.add(r.target_id);
  }

  const parentsOf = new Map<number, number[]>();
  for (const e of parentEdges) {
    if (!parentsOf.has(e.c)) parentsOf.set(e.c, []);
    parentsOf.get(e.c)!.push(e.p);
  }

  // ---- 2. 世代迭代至收敛；不收敛者为环（孤岛） ----
  const gen = new Map<number, number>(chars.map((c) => [c.id, 0]));
  const rounds = chars.length + 2; // 无环时最深链 n-1 轮必收敛
  let islandIds: number[] = [];
  for (let i = 0; i < rounds; i++) {
    const changed = new Set<number>();
    for (const c of chars) {
      const ps = parentsOf.get(c.id);
      if (!ps?.length) continue;
      const g = Math.max(...ps.map((p) => gen.get(p) ?? 0)) + 1;
      if (g !== gen.get(c.id)) {
        gen.set(c.id, g);
        changed.add(c.id);
      }
    }
    if (changed.size === 0) {
      islandIds = [];
      break;
    }
    islandIds = [...changed];
  }
  const islandSet = new Set(islandIds);

  const laid = chars.filter((c) => !islandSet.has(c.id));
  const maxGen = Math.max(0, ...laid.map((c) => gen.get(c.id) ?? 0));

  // ---- 3. 配偶 union-find 成单元 ----
  const parent = new Map<number, number>(chars.map((c) => [c.id, c.id]));
  const find = (x: number): number => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      parent.set(x, parent.get(x)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const [a, b] of spousePairs) parent.set(find(a), find(b));

  const unitMembers = new Map<number, number[]>();
  for (const c of laid) {
    const r = find(c.id);
    if (!unitMembers.has(r)) unitMembers.set(r, []);
    unitMembers.get(r)!.push(c.id);
  }

  const unitChildren = new Map<number, Set<number>>();
  const hasParentUnit = new Set<number>();
  for (const e of parentEdges) {
    if (islandSet.has(e.c) || islandSet.has(e.p)) continue;
    const pu = find(e.p);
    const cu = find(e.c);
    if (pu === cu) continue;
    if (!unitChildren.has(pu)) unitChildren.set(pu, new Set());
    unitChildren.get(pu)!.add(cu);
    hasParentUnit.add(cu);
  }

  const unitWidth = (u: number) => {
    const n = unitMembers.get(u)!.length;
    return n * NODE_W + (n - 1) * GAP_X;
  };

  // 子树宽（单元级成环时按叶处理，depth 防护）
  const widthCache = new Map<number, number>();
  const subtreeWidth = (u: number, depth: number): number => {
    if (widthCache.has(u)) return widthCache.get(u)!;
    const kids = [...(unitChildren.get(u) ?? [])];
    let w = unitWidth(u);
    if (kids.length && depth < chars.length) {
      const kw =
        kids.reduce((s, k) => s + subtreeWidth(k, depth + 1), 0) + (kids.length - 1) * GAP_UNIT;
      w = Math.max(w, kw);
    }
    widthCache.set(u, w);
    return w;
  };

  // ---- 4. 递归定位：单元在其分配宽度内居中于子女跨度之上 ----
  const nodeX = new Map<number, number>();
  const assign = (u: number, left: number, depth: number) => {
    const members = [...(unitMembers.get(u) ?? [])].sort(
      (a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0),
    );
    const kids = [...(unitChildren.get(u) ?? [])];
    const w = subtreeWidth(u, 0);
    let unitX: number;
    if (kids.length && depth < chars.length) {
      const span =
        kids.reduce((s, k) => s + subtreeWidth(k, 0), 0) + (kids.length - 1) * GAP_UNIT;
      let cx = left + (w - span) / 2;
      for (const k of kids) {
        assign(k, cx, depth + 1);
        cx += subtreeWidth(k, 0) + GAP_UNIT;
      }
      const kidsLeft = left + (w - span) / 2;
      const kidsMid = kidsLeft + span / 2;
      unitX = kidsMid - unitWidth(u) / 2;
    } else {
      unitX = left;
    }
    members.forEach((m, i) => nodeX.set(m, unitX + i * (NODE_W + GAP_X)));
  };

  let cursor = PAD;
  const roots = [...unitMembers.keys()]
    .filter((u) => !hasParentUnit.has(u))
    .sort((a, b) => Math.min(...unitMembers.get(a)!.map((id) => idx.get(id) ?? 0)) -
      Math.min(...unitMembers.get(b)!.map((id) => idx.get(id) ?? 0)));
  for (const r of roots) {
    assign(r, cursor, 0);
    cursor += subtreeWidth(r, 0) + GAP_UNIT;
  }
  // 防护：单元级成环漏网的 laid 单元（理论上难触发）也给出位置
  for (const c of laid) {
    if (!nodeX.has(c.id)) nodeX.set(c.id, cursor);
  }

  // ---- 5. 汇总边（节点在未入谱/孤岛行定位后统一构建，避免重复） ----
  const centerX = new Map<number, number>();
  for (const c of laid) {
    centerX.set(c.id, (nodeX.get(c.id) ?? 0) + NODE_W / 2);
  }
  const yOf = (id: number) => PAD + (gen.get(id) ?? 0) * LEVEL_H;

  const edges: FamilyEdge[] = [];
  for (const e of parentEdges) {
    if (islandSet.has(e.c) || islandSet.has(e.p)) continue;
    edges.push({
      x1: centerX.get(e.p)!,
      y1: yOf(e.p) + NODE_H,
      x2: centerX.get(e.c)!,
      y2: yOf(e.c),
      kind: "parent",
    });
  }
  for (const members of unitMembers.values()) {
    const ms = [...members].sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0));
    for (let i = 1; i < ms.length; i++) {
      const a = ms[i - 1];
      const b = ms[i];
      const y = Math.max(yOf(a), yOf(b)) + NODE_H / 2;
      edges.push({ x1: centerX.get(a)!, y1: y, x2: centerX.get(b)!, y2: y, kind: "spouse" });
    }
  }

  // ---- 6. 未入谱行与孤岛行 ----
  const strayIds = laid.filter((c) => !hasFamilyEdge.has(c.id)).map((c) => c.id);
  const rowY = (row: number) => PAD + (maxGen + 1 + row) * LEVEL_H;
  let sx = PAD;
  for (const id of strayIds) {
    nodeX.set(id, sx);
    centerX.set(id, sx + NODE_W / 2);
    gen.set(id, maxGen + 1);
    sx += NODE_W + GAP_X;
  }
  const nodes: FamilyNode[] = laid.map((c) => ({
    char: c,
    x: nodeX.get(c.id) ?? 0,
    y: yOf(c.id),
    gen: gen.get(c.id) ?? 0,
  }));
  let ix = PAD;
  for (const id of islandIds) {
    nodes.push({ char: byId.get(id)!, x: ix, y: rowY(1), gen: maxGen + 2 });
    ix += NODE_W + GAP_X;
  }

  const allX = nodes.map((n) => n.x);
  const allY = nodes.map((n) => n.y);
  const width = Math.max(0, ...allX) + NODE_W + PAD;
  const height = Math.max(0, ...allY) + NODE_H + PAD;
  return { nodes, edges, islandIds, strayIds, width, height };
}
