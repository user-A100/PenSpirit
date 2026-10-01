import { create } from "zustand";

// 侧栏（Binder）交互态（阶段 3A）：行内重命名、多选（锚点规则同 Scrivener：Shift 以锚点为端点，
// Ctrl 点击切换并重置锚点）、过滤、作用域（整本书 / 某个集合）。

export type RenameTarget = { kind: "chapter" | "book"; id: number };
export type BinderScope =
  | { kind: "book" }
  | { kind: "collection"; id: number; name: string; collectionKind: "manual" | "saved"; query: string };

interface BinderState {
  renaming: RenameTarget | null;
  /** 选中的章节 id（按目录序存放） */
  selected: number[];
  anchor: number | null;
  filter: string;
  scope: BinderScope;
  /** 「在目录中定位当前章」请求计数（Binder 监听它滚动并聚焦当前章行） */
  revealSeq: number;
  reveal: () => void;
  /** 阶段 3B：聚焦单卷（Hoist）——侧栏只显示该卷的章；null = 全书 */
  hoist: number | null;
  setHoist: (id: number | null) => void;
  startRename: (target: RenameTarget) => void;
  stopRename: () => void;
  /** 单选（普通点击） */
  selectOne: (id: number) => void;
  /** Ctrl 点击：切换并把锚点移到它 */
  toggle: (id: number, order: number[]) => void;
  /** Shift 点击 / Shift+方向键：锚点到 id 的连续区间 */
  selectRange: (id: number, order: number[]) => void;
  setSelection: (ids: number[], order: number[], anchor?: number | null) => void;
  clearSelection: () => void;
  setFilter: (f: string) => void;
  setScope: (s: BinderScope) => void;
}

function inOrder(ids: Iterable<number>, order: number[]): number[] {
  const set = new Set(ids);
  return order.filter((id) => set.has(id));
}

export const useBinder = create<BinderState>((set, get) => ({
  renaming: null,
  selected: [],
  anchor: null,
  filter: "",
  scope: { kind: "book" },
  revealSeq: 0,
  reveal: () => set((s) => ({ revealSeq: s.revealSeq + 1 })),
  hoist: null,
  setHoist: (hoist) => set({ hoist, filter: "" }),
  startRename: (target) => set({ renaming: target }),
  stopRename: () => set({ renaming: null }),
  selectOne: (id) => set({ selected: [id], anchor: id }),
  toggle: (id, order) => {
    const cur = get().selected;
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
    set({ selected: inOrder(next, order), anchor: id });
  },
  selectRange: (id, order) => {
    const anchor = get().anchor ?? id;
    const a = order.indexOf(anchor);
    const b = order.indexOf(id);
    if (a < 0 || b < 0) {
      set({ selected: [id], anchor: id });
      return;
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    set({ selected: order.slice(lo, hi + 1) });
  },
  setSelection: (ids, order, anchor) => set({ selected: inOrder(ids, order), anchor: anchor === undefined ? get().anchor : anchor }),
  clearSelection: () => set({ selected: [], anchor: null }),
  setFilter: (filter) => set({ filter }),
  setScope: (scope) => set({ scope, selected: [], anchor: null, filter: "", hoist: null }),
}));
