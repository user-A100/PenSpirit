import { useMemo } from "react";
import { Columns3, FileStack, LayoutGrid, X } from "lucide-react";
import { useWorkspace, type PaneId } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { useCollections } from "../../stores/collections";
import { useGroupView, type LensMode } from "../../stores/groupView";
import { mergeSubsetOrder } from "../../lib/binderDnd";
import { openChapter } from "../../lib/binderActions";
import { commandShortcut } from "../../lib/commands";
import type { ChapterMeta } from "../../lib/tauri";
import { Corkboard } from "./Corkboard";
import { OutlinerTable } from "./OutlinerTable";
import { Scrivenings } from "./Scrivenings";

// 组视图（阶段 3A，Scrivener Group View Mode）：编辑区窗格里以串烧 / 卡片墙 / 大纲列呈现「当前组」。
// 当前组 = Binder 多选（≥2 章，按作用域顺序）；否则 = Binder 作用域（整本书 / 某集合）。
// 重排写回作用域：整本书 → 目录序（子集并回全序）；手动集合 → 集合序；搜索集合只读。

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
  kind: "selection" | "book" | "collection";
}

export function useGroupContent(): GroupContent {
  const chapters = useWorkspace((s) => s.chapters);
  const books = useWorkspace((s) => s.books);
  const bookId = useWorkspace((s) => s.currentBookId);
  const selected = useBinder((s) => s.selected);
  const scope = useBinder((s) => s.scope);
  const allMembers = useCollections((s) => s.members);
  return useMemo(() => {
    const byId = new Map(chapters.map((c) => [c.id, c]));
    const base = scope.kind === "book" ? chapters : (allMembers[scope.id] ?? []).map((m) => byId.get(m.id) ?? m);
    const baseIds = base.map((c) => c.id);
    const picked = selected.length > 1 ? base.filter((c) => selected.includes(c.id)) : [];
    const subset = picked.length > 1;
    const canReorder = scope.kind === "book" || scope.collectionKind === "manual";
    const writeBase = async (ids: number[]) => {
      if (scope.kind === "book") await useWorkspace.getState().reorderChapters(ids);
      else await useCollections.getState().reorder(scope.id, ids);
    };
    const bookTitle = books.find((b) => b.id === bookId)?.title ?? "";
    return {
      chapters: subset ? picked : base,
      reorder: canReorder ? (ids: number[]) => writeBase(mergeSubsetOrder(baseIds, ids)) : null,
      allowFreeform: scope.kind === "book" && !subset,
      title: subset ? `已选 ${picked.length} 章` : scope.kind === "collection" ? `集合「${scope.name}」` : bookTitle ? `《${bookTitle}》全书` : "全书",
      kind: subset ? "selection" : scope.kind,
    };
  }, [chapters, books, bookId, selected, scope, allMembers]);
}

export function GroupView({ pane, mode }: { pane: PaneId; mode: LensMode }) {
  const g = useGroupContent();
  const setMode = useGroupView((s) => s.setMode);
  const words = g.chapters.reduce((n, c) => n + c.word_count, 0);
  const onOpen = (id: number) => {
    useWorkspace.getState().focusPane(pane);
    void openChapter(id);
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
          {g.chapters.length} 章 · {words.toLocaleString()} 字
        </span>
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
