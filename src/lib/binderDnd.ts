// Binder 拖放的纯计算（阶段 3A）：插入位置与重排结果，与 DOM 解耦便于测试。

export interface RowBox {
  id: number;
  top: number;
  bottom: number;
}

/**
 * 指针 y → 插入下标（0..rows.length）：落在某行上半 → 插到它前面，下半 → 插到它后面。
 * 行之间的缝隙按就近行处理。
 */
export function dropIndex(rows: RowBox[], y: number): number {
  for (let i = 0; i < rows.length; i++) {
    const mid = (rows[i].top + rows[i].bottom) / 2;
    if (y < mid) return i;
  }
  return rows.length;
}

/**
 * 把 moving（可不连续）整体移到 order 中的插入下标 index 处：多选聚拢、保持相对顺序
 * （Scrivener：多选拖拽聚拢到落点）。index 以「移动前」的 order 计。返回新顺序；无变化返回原数组。
 */
export function applyMove(order: number[], moving: number[], index: number): number[] {
  const set = new Set(moving);
  const kept = order.filter((id) => !set.has(id));
  const moved = order.filter((id) => set.has(id));
  if (moved.length === 0) return order;
  // 插入点之前有几个被移走的元素，插入下标就要往前挪几位
  const removedBefore = order.slice(0, index).filter((id) => set.has(id)).length;
  const at = Math.max(0, Math.min(kept.length, index - removedBefore));
  const next = [...kept.slice(0, at), ...moved, ...kept.slice(at)];
  return next.every((id, i) => id === order[i]) ? order : next;
}

/** 选中项整体上移 / 下移一格（Ctrl+↑/↓）；到边界不动 */
export function nudge(order: number[], moving: number[], dir: -1 | 1): number[] {
  const set = new Set(moving);
  const idx = order.map((id, i) => (set.has(id) ? i : -1)).filter((i) => i >= 0);
  if (idx.length === 0) return order;
  if (dir === -1 && idx[0] === 0) return order;
  if (dir === 1 && idx[idx.length - 1] === order.length - 1) return order;
  const next = [...order];
  const seq = dir === -1 ? idx : [...idx].reverse();
  for (const i of seq) {
    const j = i + dir;
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

/** 子集重排写回全序：把 full 中属于子集的位置按 newSubset 的顺序依次填回 */
export function mergeSubsetOrder(full: number[], newSubset: number[]): number[] {
  const set = new Set(newSubset);
  let k = 0;
  return full.map((id) => (set.has(id) ? newSubset[k++] : id));
}
