import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, FileText, Filter, FolderPlus, LocateFixed, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useWorkspace, type PaneId } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useBinder } from "../../stores/binder";
import { useCollections } from "../../stores/collections";
import { useGroupView } from "../../stores/groupView";
import { openContextMenu, type MenuEntry } from "../../stores/menu";
import { confirmDialog, promptDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { applyMove, dropIndex, mergeSubsetOrder, nudge } from "../../lib/binderDnd";
import { chapterMenu, deleteChapters, newChapterAfter, newCollection, openChapter } from "../../lib/binderActions";
import { getEditorFor } from "../../lib/editorBridge";
import { commandShortcut } from "../../lib/commands";
import { initials } from "../../lib/pinyin";
import type { ChapterMeta, Collection, Label, Status } from "../../lib/tauri";
import { RenameInput } from "./RenameInput";

// Binder（阶段 3A，Scrivener Binder 交互移植；数据结构不动，卷层级在 3B）：
// - 选择驱动：单击 = 选中并打开；Ctrl 点击切换、Shift 点击以锚点连选；多选时编辑区切到组视图
// - 键盘：↑↓ 选中并打开、Shift+↑↓ 扩选、Ctrl+↑↓ 移位、Enter 进入正文、F2 改名、Del 删除、Ctrl+A 全选、Esc 收拢
// - Pointer 拖放：2px 圆头插入线 + 两侧让位、多选聚拢、贴边自动滚动；拖到集合标签 = 加入；拖进正文 = 插入 [[章题]]
// - 顶部集合标签页：选中集合时列表 = 集合成员（手动集合可拖拽排序 / Del 移出），列表底色染集合色
// - 过滤：标题（含拼音首字母）/ 梗概 / 标签 / 状态

const ROW =
  "group/row relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-[var(--r-control)] px-2 outline-none transition-[background-color,color,box-shadow,transform] duration-[var(--dur-md)] focus-visible:[box-shadow:var(--focus-ring)]";
const ROW_IDLE = "text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";
const ROW_SELECTED = "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]";
/** 多选：一片连续的淡底（不是一摞稿纸），当前章另由左缘细条标出 */
const ROW_MULTI = "bg-[var(--fill-active)] text-[color:var(--text-primary)]";
const ICON_BTN =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-control)] text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";
const TAB = "flex h-6 shrink-0 items-center gap-1 rounded-[var(--r-control)] px-2 text-xs transition-[background-color,color,box-shadow] duration-[var(--dur-md)]";
const TAB_ON = "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]";
const TAB_OFF = "text-[color:var(--text-faint)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";
const FOLLOW_KEY = "bixian.binder.follow";
/** 贴边自动滚动的感应带（px） */
const EDGE = 28;

type DropTarget =
  | { kind: "list"; index: number; lineTop: number }
  | { kind: "collection"; id: number }
  | { kind: "editor"; pane: PaneId }
  | null;
interface DragView {
  moving: number[];
  x: number;
  y: number;
  target: DropTarget;
}

/** 过滤命中：标题子串 / 拼音首字母、梗概、标签名、状态名 */
export function binderMatch(c: ChapterMeta, query: string, labels: Label[], statuses: Status[]): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  if (c.title.toLowerCase().includes(q)) return true;
  if (/^[a-z0-9]+$/.test(q) && initials(c.title).includes(q)) return true;
  if (c.synopsis.toLowerCase().includes(q)) return true;
  const l = labels.find((x) => x.id === c.label_id);
  if (l && l.title.toLowerCase().includes(q)) return true;
  const st = statuses.find((x) => x.id === c.status_id);
  return st != null && st.title.toLowerCase().includes(q);
}

/** 目标进度微环（Ulysses 式）：满 100% 实心 */
function ProgressRing({ pct, tip }: { pct: number; tip: string }) {
  const r = 4.5;
  const len = 2 * Math.PI * r;
  return (
    <span data-tip={tip} className="flex shrink-0 items-center" aria-label={tip}>
      <svg width="12" height="12" viewBox="0 0 12 12" className="-rotate-90">
        <circle cx="6" cy="6" r={r} fill="none" stroke="var(--fill-active)" strokeWidth="2" />
        {pct >= 100 ? (
          <circle cx="6" cy="6" r={r + 1} fill="var(--accent)" />
        ) : (
          <circle cx="6" cy="6" r={r} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeDasharray={`${(len * pct) / 100} ${len}`} />
        )}
      </svg>
    </span>
  );
}

function readFollow(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === "1";
  } catch {
    return false;
  }
}

export function Binder() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const renameChapter = useWorkspace((s) => s.renameChapter);
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const selected = useBinder((s) => s.selected);
  const filter = useBinder((s) => s.filter);
  const scope = useBinder((s) => s.scope);
  const renaming = useBinder((s) => s.renaming);
  const revealSeq = useBinder((s) => s.revealSeq);
  const collections = useCollections((s) => s.list);
  const allMembers = useCollections((s) => s.members);
  const [filterOpen, setFilterOpen] = useState(false);
  const [follow, setFollow] = useState(readFollow);
  const [drag, setDrag] = useState<DragView | null>(null);
  const [flashId, setFlashId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  // 换书：回到整本书作用域、拉集合列表
  useEffect(() => {
    useBinder.getState().setScope({ kind: "book" });
    if (currentBookId != null) void useCollections.getState().load(currentBookId);
  }, [currentBookId]);

  // 集合作用域：进入时、章节变化时（改名 / 增删 / 正文变动会影响搜索集合）重拉成员
  const scopeColId = scope.kind === "collection" ? scope.id : null;
  useEffect(() => {
    if (scopeColId != null) void useCollections.getState().loadMembers(scopeColId);
  }, [scopeColId, chapters]);

  const byId = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
  // 集合成员用工作区里的最新元数据（改名后立即反映），成员顺序以集合为准
  const base = useMemo<ChapterMeta[]>(
    () => (scope.kind === "book" ? chapters : (allMembers[scope.id] ?? []).map((m) => byId.get(m.id) ?? m)),
    [scope, chapters, allMembers, byId],
  );
  const visible = useMemo(() => (filter.trim() ? base.filter((c) => binderMatch(c, filter, labels, statuses)) : base), [base, filter, labels, statuses]);
  const order = useMemo(() => visible.map((c) => c.id), [visible]);
  const baseIds = useMemo(() => base.map((c) => c.id), [base]);
  const canReorder = scope.kind === "book" || scope.collectionKind === "manual";
  const inCollection = scope.kind === "collection" ? { id: scope.id, kind: scope.collectionKind } : null;

  // 拖放 / 键盘回调里读最新值（window 监听器在按下时创建）
  const live = useRef({ order, baseIds, canReorder, chapters });
  live.current = { order, baseIds, canReorder, chapters };

  const rowEl = (id: number) => listRef.current?.querySelector<HTMLElement>(`[data-chapter-row="${id}"]`) ?? null;

  // 单选时选择跟随当前章（命令面板 / 前进后退 / 卡片墙点选都会改当前章）；可选自动滚动跟随
  useEffect(() => {
    if (currentChapterId == null) return;
    const b = useBinder.getState();
    if (b.selected.length <= 1 && b.selected[0] !== currentChapterId) b.selectOne(currentChapterId);
    if (follow) rowEl(currentChapterId)?.scrollIntoView({ block: "nearest" });
  }, [currentChapterId, follow]);

  // 在目录中定位当前章：必要时回到整本书 / 清过滤，滚动到位、聚焦并闪一下
  useEffect(() => {
    if (revealSeq === 0) return;
    const id = useWorkspace.getState().currentChapterId;
    const b = useBinder.getState();
    if (id != null && !live.current.order.includes(id)) {
      if (b.scope.kind !== "book") b.setScope({ kind: "book" });
      else b.setFilter("");
    }
    const t = window.setTimeout(() => {
      const el = id != null ? rowEl(id) : (listRef.current?.querySelector<HTMLElement>("[data-chapter-row]") ?? null);
      el?.scrollIntoView({ block: "nearest" });
      el?.focus({ preventScroll: true });
      if (id != null) {
        if (useBinder.getState().selected.length === 0) useBinder.getState().selectOne(id);
        setFlashId(id);
        window.setTimeout(() => setFlashId(null), 900);
      }
    }, 30);
    return () => window.clearTimeout(t);
  }, [revealSeq]);

  /** 重排写回：可见子集的新顺序并回作用域全序 */
  const writeOrder = (nextVisible: number[]) => {
    const full = mergeSubsetOrder(live.current.baseIds, nextVisible);
    const sc = useBinder.getState().scope;
    if (sc.kind === "book") void useWorkspace.getState().reorderChapters(full);
    else if (sc.collectionKind === "manual") void useCollections.getState().reorder(sc.id, full);
  };

  /** 选区为空时把当前章作为起点（Ctrl/Shift 扩选的直觉起点） */
  const seed = () => {
    const b = useBinder.getState();
    const cur = useWorkspace.getState().currentChapterId;
    const ord = live.current.order;
    if (b.selected.length === 0 && cur != null && ord.includes(cur)) b.setSelection([cur], ord, cur);
  };
  /** 多选 → 活动窗格切到组视图（偏好模式） */
  const afterMulti = () => {
    if (useBinder.getState().selected.length > 1) useGroupView.getState().showGroup(useWorkspace.getState().activePane);
  };
  const selectionFor = (id: number) => {
    const sel = useBinder.getState().selected;
    return sel.includes(id) ? live.current.order.filter((x) => sel.includes(x)) : [id];
  };
  const removeFromCollection = async (colId: number, ids: number[]) => {
    for (const id of ids) await useCollections.getState().removeChapter(colId, id);
  };

  // ---------- 点击 / 右键 ----------
  const suppressClick = useRef(false);
  const onRowClick = (e: React.MouseEvent, id: number) => {
    if (suppressClick.current) return;
    const b = useBinder.getState();
    if (e.ctrlKey || e.metaKey) {
      seed();
      b.toggle(id, order);
      afterMulti();
    } else if (e.shiftKey) {
      seed();
      b.selectRange(id, order);
      afterMulti();
    } else {
      void openChapter(id);
    }
  };
  const onRowMenu = (e: React.MouseEvent, id: number) => openContextMenu(e, chapterMenu(selectionFor(id), { inCollection }));

  // ---------- 键盘 ----------
  const focusRow = (id: number) => rowEl(id)?.focus();
  const onListKey = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
    const b = useBinder.getState();
    const rowAttr = target.closest<HTMLElement>("[data-chapter-row]")?.dataset.chapterRow;
    const cur = rowAttr != null ? Number(rowAttr) : (b.selected[b.selected.length - 1] ?? useWorkspace.getState().currentChapterId ?? order[0]);
    if (cur == null) return;
    const idx = order.indexOf(cur);
    const mod = e.ctrlKey || e.metaKey;
    const go = (ni: number, extend: boolean) => {
      if (order.length === 0) return;
      const nid = order[Math.max(0, Math.min(order.length - 1, ni))];
      if (extend) {
        seed();
        b.selectRange(nid, order);
        afterMulti();
      } else {
        void openChapter(nid);
      }
      focusRow(nid);
    };
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        if (mod) {
          if (!canReorder) return;
          const next = nudge(order, selectionFor(cur), dir);
          if (next !== order) writeOrder(next);
          return;
        }
        go(idx < 0 ? 0 : idx + dir, e.shiftKey);
        return;
      }
      case "Home":
        e.preventDefault();
        go(0, e.shiftKey);
        return;
      case "End":
        e.preventDefault();
        go(order.length - 1, e.shiftKey);
        return;
      case "Enter":
        e.preventDefault();
        void openChapter(cur).then(() => getEditorFor(useWorkspace.getState().activePane)?.focus());
        return;
      case "F2":
        e.preventDefault();
        b.startRename({ kind: "chapter", id: cur });
        return;
      case "Delete": {
        e.preventDefault();
        const ids = selectionFor(cur);
        if (inCollection?.kind === "manual") void removeFromCollection(inCollection.id, ids);
        else void deleteChapters(ids);
        return;
      }
      case "Escape":
        if (b.selected.length > 1) {
          e.preventDefault();
          const c = useWorkspace.getState().currentChapterId;
          if (c != null) b.selectOne(c);
          else b.clearSelection();
        } else if (b.filter) {
          e.preventDefault();
          b.setFilter("");
        }
        return;
      default:
        if (mod && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "a") {
          e.preventDefault();
          b.setSelection(order, order, order[0] ?? null);
          afterMulti();
        }
    }
  };

  // ---------- Pointer 拖放 ----------
  const dragRef = useRef<{ id: number; x: number; y: number; lastX: number; lastY: number; started: boolean; moving: number[]; cleanup: () => void } | null>(null);
  const scrollV = useRef(0);
  const rafId = useRef(0);

  const hitTest = (x: number, y: number): DropTarget => {
    const el = (document.elementFromPoint?.(x, y) ?? null) as HTMLElement | null;
    if (!el) return null;
    const tab = el.closest<HTMLElement>("[data-collection-tab]");
    if (tab) return tab.dataset.kind === "manual" ? { kind: "collection", id: Number(tab.dataset.collectionTab) } : null;
    const list = listRef.current;
    const inner = innerRef.current;
    if (list && inner && list.contains(el)) {
      if (!live.current.canReorder) return null;
      // offsetTop 不受让位 transform 影响，避免插入线随让位抖动
      const top0 = inner.getBoundingClientRect().top;
      const rows = [...inner.querySelectorAll<HTMLElement>("[data-chapter-row]")].map((r) => ({
        id: Number(r.dataset.chapterRow),
        top: top0 + r.offsetTop,
        bottom: top0 + r.offsetTop + r.offsetHeight,
      }));
      if (rows.length === 0) return null;
      const index = dropIndex(rows, y);
      const lineTop = index < rows.length ? rows[index].top - top0 - 1 : rows[rows.length - 1].bottom - top0 + 1;
      return { kind: "list", index, lineTop };
    }
    const pm = el.closest<HTMLElement>(".ProseMirror");
    const pane = pm?.closest<HTMLElement>("[data-pane]")?.dataset.pane;
    if (pm && (pane === "a" || pane === "b")) return { kind: "editor", pane };
    return null;
  };

  const updateDrag = () => {
    const d = dragRef.current;
    if (!d?.started) return;
    setDrag({ moving: d.moving, x: d.lastX, y: d.lastY, target: hitTest(d.lastX, d.lastY) });
  };
  const stopScroll = () => {
    scrollV.current = 0;
    if (rafId.current) cancelAnimationFrame(rafId.current);
    rafId.current = 0;
  };
  const autoScroll = (x: number, y: number) => {
    const list = listRef.current;
    if (!list) return;
    const r = list.getBoundingClientRect();
    const inX = x >= r.left && x <= r.right;
    let v = 0;
    if (inX && y >= r.top - 8 && y < r.top + EDGE) v = -Math.min(16, Math.ceil((r.top + EDGE - y) / 3));
    else if (inX && y > r.bottom - EDGE && y <= r.bottom + 8) v = Math.min(16, Math.ceil((y - (r.bottom - EDGE)) / 3));
    scrollV.current = v;
    if (v !== 0 && !rafId.current) {
      const tick = () => {
        const l = listRef.current;
        if (!scrollV.current || !l) {
          rafId.current = 0;
          return;
        }
        l.scrollTop += scrollV.current;
        updateDrag();
        rafId.current = requestAnimationFrame(tick);
      };
      rafId.current = requestAnimationFrame(tick);
    }
  };

  const drop = async (target: NonNullable<DropTarget>, moving: number[], x: number, y: number) => {
    if (target.kind === "list") {
      const ord = live.current.order;
      const next = applyMove(ord, moving, target.index);
      if (next !== ord) writeOrder(next);
    } else if (target.kind === "collection") {
      await useCollections.getState().addChapters(target.id, moving);
    } else {
      const titles = moving.map((id) => live.current.chapters.find((c) => c.id === id)?.title).filter((t): t is string => !!t);
      if (titles.length === 0) return;
      useWorkspace.getState().focusPane(target.pane);
      const ok = getEditorFor(target.pane)?.insertAtPoint?.(x, y, titles.map((t) => `[[${t}]]`).join("、")) ?? false;
      if (!ok) toast.error("没能插入链接：请拖到正文文字上");
    }
  };

  const onRowPointerDown = (e: React.PointerEvent, id: number) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || useBinder.getState().renaming) return;
    dragRef.current?.cleanup();
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      d.lastX = ev.clientX;
      d.lastY = ev.clientY;
      if (!d.started) {
        if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 5) return;
        d.started = true;
        d.moving = selectionFor(d.id);
        document.body.dataset.binderDragging = "";
      }
      autoScroll(ev.clientX, ev.clientY);
      updateDrag();
    };
    const finish = (ev: PointerEvent | null) => {
      const d = dragRef.current;
      cleanup();
      if (!d?.started) return;
      // 拖完松手不触发行点击（否则会打开被拖的章）
      suppressClick.current = true;
      window.setTimeout(() => (suppressClick.current = false), 0);
      setDrag(null);
      const target = ev ? hitTest(ev.clientX, ev.clientY) : null;
      if (target && ev) void drop(target, d.moving, ev.clientX, ev.clientY);
    };
    const up = (ev: PointerEvent) => finish(ev);
    const cancel = () => finish(null);
    const key = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" && dragRef.current?.started) {
        ev.preventDefault();
        ev.stopPropagation();
        finish(null);
      }
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      stopScroll();
      delete document.body.dataset.binderDragging;
      dragRef.current = null;
    };
    dragRef.current = { id, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, started: false, moving: [], cleanup };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };
  useEffect(() => () => dragRef.current?.cleanup(), []);

  // ---------- 集合标签 ----------
  const openScope = (col: Collection) =>
    useBinder.getState().setScope({ kind: "collection", id: col.id, name: col.name, collectionKind: col.kind, query: col.query });
  const collectionMenu = (col: Collection): MenuEntry[] => [
    ...(col.kind === "saved" ? [{ type: "label" as const, label: `搜索：${col.query}` }] : []),
    {
      label: "重命名集合…",
      icon: Pencil,
      onSelect: async () => {
        const name = await promptDialog({ title: "重命名集合", initial: col.name, confirmLabel: "确定" });
        if (!name || name === col.name) return;
        await useCollections.getState().rename(col.id, name);
        const sc = useBinder.getState().scope;
        if (sc.kind === "collection" && sc.id === col.id) useBinder.setState({ scope: { ...sc, name } });
      },
    },
    {
      label: "删除集合…",
      icon: Trash2,
      danger: true,
      onSelect: async () => {
        const ok = await confirmDialog({ title: `删除集合「${col.name}」？`, message: "章节本身不受影响。", confirmLabel: "删除", danger: true });
        if (!ok) return;
        const sc = useBinder.getState().scope;
        if (sc.kind === "collection" && sc.id === col.id) useBinder.getState().setScope({ kind: "book" });
        await useCollections.getState().remove(col.id);
      },
    },
  ];

  const toggleFollow = () => {
    const v = !follow;
    setFollow(v);
    try {
      localStorage.setItem(FOLLOW_KEY, v ? "1" : "0");
    } catch {
      // 忽略
    }
  };
  const sectionMenu = (): MenuEntry[] => [
    { label: "在目录中定位当前章", icon: LocateFixed, shortcut: commandShortcut("binder.reveal"), onSelect: () => useBinder.getState().reveal() },
    { label: "自动跟随当前章", checked: follow, onSelect: toggleFollow },
    { type: "separator" },
    { label: "新建集合…", icon: FolderPlus, onSelect: () => void newCollection([], true) },
  ];

  const showFilter = filterOpen || filter !== "";
  const multi = selected.length > 1;
  const focusId = selected[selected.length - 1] ?? currentChapterId ?? order[0];
  const movingSet = new Set(drag?.moving ?? []);
  const lineIdx = drag?.target?.kind === "list" ? drag.target.index : -1;
  const dropColId = drag?.target?.kind === "collection" ? drag.target.id : null;
  const dragHint =
    drag?.target?.kind === "list"
      ? "移到这里"
      : drag?.target?.kind === "collection"
        ? `加入「${collections.find((c) => c.id === dropColId)?.name ?? ""}」`
        : drag?.target?.kind === "editor"
          ? "插入 [[章题]]"
          : "";
  const inCol = scope.kind === "collection";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 作用域标签：全书 + 各集合（拖章到手动集合标签 = 加入） */}
      {collections.length > 0 && (
        <div role="tablist" aria-label="目录范围" className="flex shrink-0 items-center gap-1 overflow-x-auto pb-1 pl-1 pr-1 [scrollbar-width:none]">
          <button role="tab" aria-selected={!inCol} onClick={() => useBinder.getState().setScope({ kind: "book" })} className={`${TAB} ${!inCol ? TAB_ON : TAB_OFF}`}>
            <FileText size={11} />
            全书
          </button>
          {collections.map((col) => {
            const on = inCol && scope.id === col.id;
            return (
              <button
                key={col.id}
                role="tab"
                aria-selected={on}
                data-collection-tab={col.id}
                data-kind={col.kind}
                data-tip={col.kind === "saved" ? `搜索集合：${col.query}` : "手动集合 · 可把章节拖到这里加入"}
                onClick={() => openScope(col)}
                onContextMenu={(e) => openContextMenu(e, collectionMenu(col))}
                className={`${TAB} ${on ? TAB_ON : TAB_OFF} ${dropColId === col.id ? "ring-2 ring-[color:var(--accent)]" : ""}`}
              >
                {col.kind === "saved" ? <Search size={11} /> : <Bookmark size={11} />}
                <span className="max-w-[7rem] truncate">{col.name}</span>
              </button>
            );
          })}
          <button aria-label="新建集合" data-tip="新建集合" onClick={() => void newCollection([], true)} className={`${ICON_BTN} h-6 w-6`}>
            <Plus size={12} />
          </button>
        </div>
      )}

      {/* 分区头：作用域名 + 计数 + 过滤 + 新建 */}
      <div className="flex h-7 shrink-0 items-center gap-1 pl-2 pr-1" onContextMenu={(e) => openContextMenu(e, sectionMenu())}>
        <span className="min-w-0 flex-1 truncate text-2xs font-medium tracking-wide text-[color:var(--text-faint)]">
          {inCol ? scope.name : "章节"}
          {base.length > 0 && <span className="ml-1 tabular-nums">{filter.trim() ? `${visible.length}/${base.length}` : base.length}</span>}
          {multi && <span className="ml-2 text-[color:var(--accent)]">已选 {selected.length}</span>}
        </span>
        <button
          onClick={() => {
            if (showFilter) {
              useBinder.getState().setFilter("");
              setFilterOpen(false);
            } else setFilterOpen(true);
          }}
          aria-label="过滤章节"
          aria-pressed={showFilter}
          data-tip="过滤（标题 / 拼音首字母 / 梗概 / 标签 / 状态）"
          className={`${ICON_BTN} ${showFilter ? "text-[color:var(--accent)]" : ""}`}
        >
          <Filter size={13} />
        </button>
        {currentBookId != null && (
          <button
            onClick={() => void newChapterAfter(selected[selected.length - 1] ?? currentChapterId)}
            aria-label="新建章节"
            data-tip="在选中章之后新建"
            data-tip-key={commandShortcut("chapter.new")}
            className={ICON_BTN}
          >
            <Plus size={15} />
          </button>
        )}
      </div>

      {showFilter && (
        <div className="flex shrink-0 items-center px-1 pb-1">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--fill-element)] px-2">
            <Filter size={12} className="shrink-0 text-[color:var(--text-faint)]" />
            <input
              autoFocus
              value={filter}
              aria-label="过滤章节关键词"
              placeholder="过滤章节…"
              onChange={(e) => useBinder.getState().setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  useBinder.getState().setFilter("");
                  setFilterOpen(false);
                } else if (e.key === "ArrowDown" || e.key === "Enter") {
                  e.preventDefault();
                  if (order[0] != null) focusRow(order[0]);
                }
              }}
              className="min-w-0 flex-1 bg-transparent text-ui text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
            />
            {filter && (
              <button aria-label="清除过滤" onClick={() => useBinder.getState().setFilter("")} className="shrink-0 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 章节列表 */}
      <div
        ref={listRef}
        role="listbox"
        aria-label="章节"
        aria-multiselectable
        onKeyDown={onListKey}
        className={`min-h-0 flex-1 overflow-y-auto pb-2 pr-1 ${inCol ? "rounded-[var(--r-control)] bg-[color:color-mix(in_srgb,var(--accent)_4%,transparent)] pl-0.5 pt-0.5" : ""}`}
      >
        {currentBookId != null && base.length === 0 && (
          <div className="mt-6 flex flex-col items-center gap-2 px-4 text-center">
            {inCol ? (
              <div className="text-ui text-[color:var(--text-faint)]">
                {scope.collectionKind === "saved" ? `没有匹配「${scope.query}」的章节` : "集合是空的：把章节拖到上方标签，或右键「加入集合」"}
              </div>
            ) : (
              <>
                <div className="text-ui text-[color:var(--text-faint)]">这本书还没有章节</div>
                <button
                  onClick={() => void newChapterAfter(null)}
                  className="rounded-[var(--r-control)] px-3 py-1.5 text-ui text-[color:var(--accent)] transition-colors hover:bg-[var(--fill-hover)]"
                >
                  新建第一章
                </button>
              </>
            )}
          </div>
        )}
        {base.length > 0 && visible.length === 0 && <div className="mt-6 px-4 text-center text-ui text-[color:var(--text-faint)]">没有匹配的章节</div>}
        <div ref={innerRef} className="relative flex flex-col gap-px">
          {visible.map((c, i) => {
            const isSel = selected.includes(c.id);
            const isCur = currentChapterId === c.id;
            // Scrivener 式标签色：章打了标签时图标染标签色
            const label = labels.find((l) => l.id === c.label_id) ?? null;
            const status = statuses.find((st) => st.id === c.status_id) ?? null;
            const editing = renaming?.kind === "chapter" && renaming.id === c.id;
            const pct = c.target_words != null && c.target_words > 0 ? Math.min(100, Math.round((c.word_count / c.target_words) * 100)) : null;
            const shift = lineIdx < 0 ? 0 : i < lineIdx ? -2 : 2;
            return (
              <div
                key={c.id}
                role="option"
                aria-selected={isSel}
                aria-current={isCur ? "true" : undefined}
                tabIndex={c.id === focusId ? 0 : -1}
                data-chapter-row={c.id}
                onPointerDown={(e) => !editing && onRowPointerDown(e, c.id)}
                onClick={(e) => onRowClick(e, c.id)}
                onDoubleClick={(e) => {
                  if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                  useBinder.getState().startRename({ kind: "chapter", id: c.id });
                }}
                onContextMenu={(e) => onRowMenu(e, c.id)}
                style={shift ? { transform: `translateY(${shift}px)` } : undefined}
                className={`${ROW} ${isSel ? (multi ? ROW_MULTI : ROW_SELECTED) : ROW_IDLE} ${movingSet.has(c.id) ? "opacity-40" : ""} ${flashId === c.id ? "binder-flash" : ""}`}
              >
                {/* 当前章的次级提示（多选中，或不在选区里时）：左缘细条 */}
                {isCur && (multi || !isSel) && <span aria-hidden className="absolute bottom-1.5 left-0 top-1.5 w-[2px] rounded-full bg-[color:var(--accent)]" />}
                <FileText
                  size={14}
                  strokeWidth={1.75}
                  className={`shrink-0 ${label ? "" : isCur ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"}`}
                  style={label ? { color: label.color } : undefined}
                />
                {editing ? (
                  <RenameInput
                    initial={c.title}
                    onCommit={(v) => {
                      useBinder.getState().stopRename();
                      void renameChapter(c.id, v);
                    }}
                    onCancel={() => {
                      useBinder.getState().stopRename();
                      focusRow(c.id);
                    }}
                  />
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate">{c.title}</span>
                    {status && <span data-tip={`状态：${status.title}`} aria-label={`状态：${status.title}`} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--text-faint)]" />}
                    <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-faint)]">{c.word_count > 0 ? c.word_count.toLocaleString() : ""}</span>
                    {pct != null && <ProgressRing pct={pct} tip={`${c.word_count.toLocaleString()} / ${c.target_words!.toLocaleString()} 字（${pct}%）`} />}
                  </>
                )}
              </div>
            );
          })}
          {drag?.target?.kind === "list" && (
            <div aria-hidden data-drop-line className="pointer-events-none absolute left-2 right-1 z-10 h-[2px] rounded-full bg-[color:var(--accent)]" style={{ top: drag.target.lineTop }}>
              <span className="absolute -left-1.5 -top-[3px] h-2 w-2 rounded-full border-2 border-[color:var(--accent)] bg-[var(--bg-panel)]" />
            </div>
          )}
        </div>
      </div>

      {drag &&
        createPortal(
          <div
            data-drag-ghost
            className="pointer-events-none fixed z-[1000] flex max-w-[16rem] items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--bg-panel)] px-2 py-1 text-xs text-[color:var(--text-primary)] [box-shadow:var(--shadow-overlay)]"
            style={{ left: drag.x + 14, top: drag.y + 10 }}
          >
            <FileText size={12} className="shrink-0 text-[color:var(--accent)]" />
            <span className="min-w-0 truncate">{drag.moving.length > 1 ? `${drag.moving.length} 章` : (byId.get(drag.moving[0])?.title ?? "")}</span>
            {dragHint && <span className="shrink-0 text-[color:var(--text-faint)]">· {dragHint}</span>}
          </div>,
          document.body,
        )}
    </div>
  );
}
