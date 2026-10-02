import { useMemo } from "react";
import { Columns3, FileStack, FileText, Focus, LayoutGrid, X } from "lucide-react";
import { useWorkspace, type PaneId } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { useCollections } from "../../stores/collections";
import { useGroupView, type LensMode } from "../../stores/groupView";
import { mergeSubsetOrder } from "../../lib/binderDnd";
import { openChapter, openNode } from "../../lib/binderActions";
import { isFolder, reorderSiblings, siblingsOf, toItems, treeOrder } from "../../lib/binderTree";
import { commandShortcut } from "../../lib/commands";
import type { ChapterMeta } from "../../lib/tauri";
import { Corkboard } from "./Corkboard";
import { OutlinerTable } from "./OutlinerTable";
import { Scrivenings } from "./Scrivenings";
import { useNodeWords } from "./lens";

// 组视图（阶段 3A，Scrivener Group View Mode；3B 起含卷）：编辑区窗格里以串烧 / 卡片墙 / 大纲列呈现「当前组」：
// - Binder 多选（≥2）→ 选中的项（按全书先序）
// - 单选一个卷 / 聚焦（Hoist）某卷 / 当前章在某卷里 → 该卷的章（Scrivener：选中文件夹看其内容）
// - 否则 → 全书顶层（卷作为卡片 + 顶层章；无卷的书即全部章节）
// 集合作用域：集合成员（或其中的多选）。
// 重排：只含章 → 「按位置」写回（后端 reorder_chapters 同语义，卷内重排即卷内）；含卷 → 同级重排走 tree_apply；
// 手动集合 → 集合序；搜索集合与跨卷的混合多选只读。

export const LENS_MODES: { id: LensMode; label: string; icon: typeof LayoutGrid }[] = [
  { id: "scrivenings", label: "串烧", icon: FileStack },
  { id: "corkboard", label: "卡片墙", icon: LayoutGrid },
  { id: "outliner", label: "大纲列", icon: Columns3 },
];

export interface GroupContent {
  chapters: ChapterMeta[];
  reorder: ((ids: number[]) => Promise<void>) | null;
  allowFreeform: boolean;
  title: string;
  kind: "selection" | "book" | "collection" | "volume";
  /** kind = volume 时为该卷 id */
  volumeId: number | null;
}

export function useGroupContent(): GroupContent {
  const chapters = useWorkspace((s) => s.chapters);
  const volumes = useWorkspace((s) => s.volumes);
  const books = useWorkspace((s) => s.books);
  const bookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selected = useBinder((s) => s.selected);
  const scope = useBinder((s) => s.scope);
  const hoist = useBinder((s) => s.hoist);
  const allMembers = useCollections((s) => s.members);
  return useMemo(() => {
    const nodes = [...volumes, ...chapters];
    const byId = new Map(nodes.map((c) => [c.id, c]));
    const items = toItems(treeOrder(nodes));
    const parentOf = new Map(items.map((i) => [i.id, i.parent_id]));
    const ordered = items.map((i) => byId.get(i.id)!).filter(Boolean);
    const textIds = chapters.map((c) => c.id);
    const slotReorder = (ids: number[]) => useWorkspace.getState().reorderChapters(mergeSubsetOrder(textIds, ids));
    const siblingReorder = (parent: number | null) => async (ids: number[]) => {
      const sib = siblingsOf(items, parent);
      await useWorkspace.getState().applyTree(reorderSiblings(items, parent, mergeSubsetOrder(sib, ids)));
    };
    const reorderFor = (list: ChapterMeta[]) => {
      if (!list.some(isFolder)) return slotReorder;
      const parent = parentOf.get(list[0].id) ?? null;
      return list.every((n) => (parentOf.get(n.id) ?? null) === parent) ? siblingReorder(parent) : null;
    };

    if (scope.kind === "collection") {
      const base = (allMembers[scope.id] ?? []).map((m) => byId.get(m.id) ?? m);
      const picked = selected.length > 1 ? base.filter((c) => selected.includes(c.id)) : [];
      const subset = picked.length > 1;
      return {
        chapters: subset ? picked : base,
        reorder:
          scope.collectionKind === "manual"
            ? async (ids: number[]) => {
                await useCollections.getState().reorder(scope.id, mergeSubsetOrder(base.map((c) => c.id), ids));
              }
            : null,
        allowFreeform: false,
        title: subset ? `已选 ${picked.length} 章` : `集合「${scope.name}」`,
        kind: subset ? "selection" : "collection",
        volumeId: null,
      };
    }

    const sel = ordered.filter((n) => selected.includes(n.id));
    if (sel.length > 1) {
      return {
        chapters: sel,
        reorder: reorderFor(sel),
        allowFreeform: false,
        title: `已选 ${sel.length} ${sel.some(isFolder) ? "项" : "章"}`,
        kind: "selection",
        volumeId: null,
      };
    }
    const cur = byId.get(currentChapterId ?? -1);
    const vol =
      (sel.length === 1 && isFolder(sel[0]) ? sel[0] : undefined) ??
      (hoist != null ? byId.get(hoist) : undefined) ??
      (cur && isFolder(cur) ? cur : undefined) ??
      byId.get(parentOf.get(cur?.id ?? -1) ?? -1);
    if (vol) {
      const kids = ordered.filter((n) => parentOf.get(n.id) === vol.id);
      return { chapters: kids, reorder: slotReorder, allowFreeform: false, title: vol.title, kind: "volume", volumeId: vol.id };
    }
    const flat = volumes.length === 0;
    const bookTitle = books.find((b) => b.id === bookId)?.title ?? "";
    return {
      chapters: ordered.filter((n) => (parentOf.get(n.id) ?? null) === null),
      reorder: flat ? slotReorder : siblingReorder(null),
      allowFreeform: flat,
      title: bookTitle ? `《${bookTitle}》全书` : "全书",
      kind: "book",
      volumeId: null,
    };
  }, [chapters, volumes, books, bookId, currentChapterId, selected, scope, hoist, allMembers]);
}

export function GroupView({ pane, mode }: { pane: PaneId; mode: LensMode }) {
  const g = useGroupContent();
  const setMode = useGroupView((s) => s.setMode);
  const wordsOf = useNodeWords();
  const words = g.chapters.reduce((n, c) => n + wordsOf(c), 0);
  const volumeCount = g.chapters.filter(isFolder).length;
  // 卷：进入它（看卷内各章）；章：打开正文
  const onOpen = (id: number) => {
    useWorkspace.getState().focusPane(pane);
    const node = g.chapters.find((c) => c.id === id);
    void (isFolder(node) ? openNode(id) : openChapter(id));
  };
  const lens = { chapters: g.chapters, reorder: g.reorder, onOpen, allowFreeform: g.allowFreeform };
  return (
    <div
      data-testid="group-view"
      data-group-mode={mode}
      onPointerDownCapture={() => {
        if (useWorkspace.getState().activePane !== pane) useWorkspace.getState().focusPane(pane);
      }}
      className="@container flex h-full flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 pl-4 pr-2">
        <span className="min-w-0 truncate text-ui font-medium text-[color:var(--text-primary)]">{g.title}</span>
        <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-faint)]">
          {volumeCount > 0 ? `${volumeCount} 卷 · ${g.chapters.length - volumeCount} 章` : `${g.chapters.length} 章`} · {words.toLocaleString()} 字
        </span>
        {g.volumeId != null && (
          <>
            <button
              onClick={() => {
                useWorkspace.getState().focusPane(pane);
                void openChapter(g.volumeId!);
              }}
              data-tip="编辑卷首语（卷自己的正文）"
              className="flex h-6 shrink-0 items-center gap-1 rounded-[var(--r-control)] px-1.5 text-xs text-[color:var(--text-secondary)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
            >
              <FileText size={12} />
              卷首语
            </button>
            {useBinder.getState().hoist !== g.volumeId && (
              <button
                onClick={() => useBinder.getState().setHoist(g.volumeId)}
                data-tip="侧栏只看这一卷（Hoist）"
                className="flex h-6 shrink-0 items-center gap-1 rounded-[var(--r-control)] px-1.5 text-xs text-[color:var(--text-secondary)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
              >
                <Focus size={12} />
                聚焦
              </button>
            )}
          </>
        )}
        <span className="flex-1" />
        <div role="radiogroup" aria-label="组视图模式" className="flex shrink-0 items-center gap-0.5 rounded-[var(--r-control)] bg-[var(--fill-element)] p-0.5">
          {LENS_MODES.map((m) => {
            const Icon = m.icon;
            const on = m.id === mode;
            return (
              <button
                key={m.id}
                role="radio"
                aria-checked={on}
                aria-label={m.label}
                data-tip={m.label}
                data-tip-key={commandShortcut(`view.group.${m.id}`)}
                onClick={() => setMode(pane, m.id)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 ${
                  on ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                <Icon size={13} />
                <span className="hidden @lg:inline">{m.label}</span>
              </button>
            );
          })}
        </div>
        <button
          aria-label="回到单章正文"
          data-tip="回到单章正文"
          data-tip-key={commandShortcut(`view.group.${mode}`)}
          onClick={() => setMode(pane, "single")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--r-control)] text-[color:var(--text-faint)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
        >
          <X size={15} />
        </button>
      </div>
      <div className="min-h-0 flex-1 px-4 pb-4">
        {mode === "corkboard" && <Corkboard {...lens} />}
        {mode === "outliner" && <OutlinerTable {...lens} />}
        {mode === "scrivenings" && (
          <div className="h-full overflow-y-auto">
            <Scrivenings {...lens} />
          </div>
        )}
      </div>
    </div>
  );
}
