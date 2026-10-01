import type { ChapterMeta } from "./tauri";
import { nudge } from "./binderDnd";

// 卷层级的纯计算（阶段 3B）：全书先序、可见行、拖放落点、移动 / 升降级 / 同级移位。
// 只有一层（卷 → 章），规则与后端 normalized_order / validate_tree 一致：卷只在顶层，卷内的章紧跟所属卷。

export type Kind = "text" | "folder";
export interface TreeItem {
  id: number;
  parent_id: number | null;
}
export type Drop = { kind: "before" | "after" | "into"; ref: number };

export const isFolder = (n: { kind?: string } | undefined | null): boolean => n?.kind === "folder";

/** 由节点（卷 + 章，带 sort_key / parent_id）规整出全书先序：顶层按 sort_key，卷后紧跟其子章 */
export function treeOrder(nodes: ChapterMeta[]): ChapterMeta[] {
  const sorted = [...nodes].sort((a, b) => a.sort_key - b.sort_key || a.id - b.id);
  const folders = new Set(sorted.filter(isFolder).map((n) => n.id));
  const parentOf = (n: ChapterMeta) => (isFolder(n) || n.parent_id == null || !folders.has(n.parent_id) ? null : n.parent_id);
  const out: ChapterMeta[] = [];
  for (const n of sorted) {
    if (parentOf(n) != null) continue;
    out.push(n);
    if (isFolder(n)) for (const c of sorted) if (parentOf(c) === n.id) out.push(c);
  }
  return out;
}

/** 先序节点 → tree_apply 清单（父节点按规整后的结构给出） */
export function toItems(order: ChapterMeta[]): TreeItem[] {
  const folders = new Set(order.filter(isFolder).map((n) => n.id));
  return order.map((n) => ({ id: n.id, parent_id: !isFolder(n) && n.parent_id != null && folders.has(n.parent_id) ? n.parent_id : null }));
}

export function kindsOf(nodes: ChapterMeta[]): Map<number, Kind> {
  return new Map(nodes.map((n) => [n.id, isFolder(n) ? "folder" : "text"]));
}

export interface Row {
  node: ChapterMeta;
  depth: 0 | 1;
  /** 卷：子章数 */
  childCount: number;
  collapsed: boolean;
  /** 过滤时为保留层级而显示、自身未命中的卷 */
  dim: boolean;
}

/**
 * 侧栏可见行：折叠的卷隐藏子章；hoist = 只看某卷的子章（顶格显示）；
 * match 给定时只显示命中项，命中章的所属卷保留并淡化（Scrivener 过滤保留祖先），过滤时忽略折叠。
 */
export function visibleRows(
  nodes: ChapterMeta[],
  opts: { collapsed?: Set<number>; hoist?: number | null; match?: ((n: ChapterMeta) => boolean) | null } = {},
): Row[] {
  const order = treeOrder(nodes);
  const items = toItems(order);
  const parent = new Map(items.map((i) => [i.id, i.parent_id]));
  const count = new Map<number, number>();
  for (const i of items) if (i.parent_id != null) count.set(i.parent_id, (count.get(i.parent_id) ?? 0) + 1);
  const row = (n: ChapterMeta, depth: 0 | 1, dim = false): Row => ({
    node: n,
    depth,
    childCount: count.get(n.id) ?? 0,
    collapsed: opts.collapsed?.has(n.id) ?? false,
    dim,
  });
  const match = opts.match ?? null;
  if (opts.hoist != null) {
    return order.filter((n) => parent.get(n.id) === opts.hoist && (!match || match(n))).map((n) => row(n, 0));
  }
  const out: Row[] = [];
  for (const n of order) {
    if (parent.get(n.id) != null) continue;
    if (!isFolder(n)) {
      if (!match || match(n)) out.push(row(n, 0));
      continue;
    }
    const kids = order.filter((c) => parent.get(c.id) === n.id);
    if (match) {
      const hit = kids.filter(match);
      const self = match(n);
      if (!self && hit.length === 0) continue;
      out.push({ ...row(n, 0, !self), collapsed: false });
      for (const c of hit) out.push(row(c, 1));
    } else {
      out.push(row(n, 0));
      if (!opts.collapsed?.has(n.id)) for (const c of kids) out.push(row(c, 1));
    }
  }
  return out;
}

/** 卷连同子章算一个移动单位；子章的卷也在选中时不重复计 */
function units(items: TreeItem[], moving: Set<number>): number[] {
  return items.filter((i) => moving.has(i.id) && !(i.parent_id != null && moving.has(i.parent_id))).map((i) => i.id);
}

/**
 * 把 moving 移到落点（多选聚拢，保持相对顺序）：
 * - into：放进卷（卷末）；含卷的选区不能放进卷
 * - before / after 卷内的章：成为该卷的同级；但选区含卷时落到整卷之前 / 之后（卷只在顶层）
 * - before / after 顶层节点：顶层；after 一个卷 = 整卷之后
 * 无变化或非法返回 null。
 */
export function moveNodes(items: TreeItem[], kinds: Map<number, Kind>, moving: number[], drop: Drop): TreeItem[] | null {
  const set = new Set(moving);
  const us = units(items, set);
  if (us.length === 0) return null;
  const parentOf = new Map(items.map((i) => [i.id, i.parent_id]));
  const refParent = parentOf.get(drop.ref);
  if (refParent === undefined || set.has(drop.ref) || (refParent != null && set.has(refParent))) return null;
  const folderMoving = us.some((u) => kinds.get(u) === "folder");
  const moved = new Set<number>();
  for (const u of us) {
    moved.add(u);
    if (kinds.get(u) === "folder") for (const i of items) if (i.parent_id === u) moved.add(i.id);
  }
  const rest = items.filter((i) => !moved.has(i.id));
  const refIdx = rest.findIndex((i) => i.id === drop.ref);
  const blockEnd = (idx: number) => {
    let j = idx + 1;
    while (j < rest.length && rest[j].parent_id === rest[idx].id) j++;
    return j;
  };
  const topStart = (idx: number) => (rest[idx].parent_id == null ? idx : rest.findIndex((i) => i.id === rest[idx].parent_id));
  let parent: number | null;
  let index: number;
  if (drop.kind === "into") {
    if (kinds.get(drop.ref) !== "folder" || folderMoving) return null;
    parent = drop.ref;
    index = blockEnd(refIdx);
  } else if (rest[refIdx].parent_id != null) {
    if (folderMoving) {
      const t = topStart(refIdx);
      parent = null;
      index = drop.kind === "before" ? t : blockEnd(t);
    } else {
      parent = rest[refIdx].parent_id;
      index = drop.kind === "before" ? refIdx : refIdx + 1;
    }
  } else {
    parent = null;
    index = drop.kind === "before" ? refIdx : blockEnd(refIdx);
  }
  const insert: TreeItem[] = [];
  for (const u of us) {
    if (kinds.get(u) === "folder") {
      insert.push({ id: u, parent_id: null });
      for (const i of items) if (i.parent_id === u) insert.push(i);
    } else {
      insert.push({ id: u, parent_id: parent });
    }
  }
  const out = [...rest.slice(0, index), ...insert, ...rest.slice(index)];
  return sameTree(out, items) ? null : out;
}

export function sameTree(a: TreeItem[], b: TreeItem[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.parent_id === b[i].parent_id);
}

/** Ctrl+→ 降级：选中的顶层章并入紧挨在前面的卷（卷末）；前面不是卷则不动 */
export function indent(items: TreeItem[], kinds: Map<number, Kind>, ids: number[]): TreeItem[] | null {
  const sel = items.filter((i) => ids.includes(i.id) && i.parent_id == null && kinds.get(i.id) === "text");
  if (sel.length === 0) return null;
  const prev = items[items.indexOf(sel[0]) - 1];
  if (!prev) return null;
  const folder = prev.parent_id ?? (kinds.get(prev.id) === "folder" ? prev.id : null);
  if (folder == null) return null;
  return moveNodes(items, kinds, sel.map((i) => i.id), { kind: "into", ref: folder });
}

/** Ctrl+← 升级：选中的卷内章移出到所属卷之后（顶层，保持相对顺序） */
export function outdent(items: TreeItem[], kinds: Map<number, Kind>, ids: number[]): TreeItem[] | null {
  const sel = items.filter((i) => ids.includes(i.id) && i.parent_id != null);
  if (sel.length === 0) return null;
  const folder = sel[0].parent_id!;
  return moveNodes(items, kinds, sel.filter((i) => i.parent_id === folder).map((i) => i.id), { kind: "after", ref: folder });
}

/** 某父节点下的同级（顶层：卷与顶层章；卷内：子章），按先序 */
export function siblingsOf(items: TreeItem[], parent: number | null): number[] {
  return items.filter((i) => i.parent_id === parent).map((i) => i.id);
}

/** 用新的同级顺序重排（顶层：卷连同子章整块移动） */
export function reorderSiblings(items: TreeItem[], parent: number | null, order: number[]): TreeItem[] {
  if (parent == null) {
    const blocks = new Map<number, TreeItem[]>();
    let cur: TreeItem[] | null = null;
    for (const i of items) {
      if (i.parent_id == null) {
        cur = [i];
        blocks.set(i.id, cur);
      } else cur?.push(i);
    }
    return order.flatMap((id) => blocks.get(id) ?? []);
  }
  const kids = order.map((id) => ({ id, parent_id: parent }));
  const out: TreeItem[] = [];
  let placed = false;
  for (const i of items) {
    if (i.parent_id === parent) {
      if (!placed) {
        out.push(...kids);
        placed = true;
      }
      continue;
    }
    out.push(i);
  }
  return out;
}

/** Ctrl+↑/↓：同级选中项整体与相邻同级交换（卷连同子章算一个单位），出不了所属卷 */
export function nudgeTree(items: TreeItem[], kinds: Map<number, Kind>, ids: number[], dir: -1 | 1): TreeItem[] | null {
  const us = units(items, new Set(ids));
  if (us.length === 0) return null;
  const parentOf = new Map(items.map((i) => [i.id, i.parent_id]));
  const parent = parentOf.get(us[0]) ?? null;
  if (us.some((u) => (parentOf.get(u) ?? null) !== parent)) return null;
  const sib = siblingsOf(items, parent);
  const next = nudge(sib, us, dir);
  if (next === sib) return null;
  void kinds;
  return reorderSiblings(items, parent, next);
}

export interface RowBox {
  id: number;
  kind: Kind;
  depth: 0 | 1;
  top: number;
  bottom: number;
}

/**
 * 指针 y → 树落点：章行上半 = before、下半 = after；卷行上 30% = before、其余 = into（放进卷末）；
 * 选区含卷时卷行按上下半分 before / after。落在所有行之下 = 最后一行之后。
 */
export function treeDropTarget(rows: RowBox[], y: number, folderMoving: boolean): Drop | null {
  if (rows.length === 0) return null;
  for (const r of rows) {
    if (y >= r.bottom) continue;
    const h = Math.max(1, r.bottom - r.top);
    const t = (y - r.top) / h;
    if (r.kind === "folder" && !folderMoving) return t < 0.3 ? { kind: "before", ref: r.id } : { kind: "into", ref: r.id };
    return t < 0.5 ? { kind: "before", ref: r.id } : { kind: "after", ref: r.id };
  }
  return { kind: "after", ref: rows[rows.length - 1].id };
}
