import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import { useMeta } from "../../stores/meta";
import { useWorkspace } from "../../stores/workspace";
import { openContextMenu, openMenuAt, type MenuEntry } from "../../stores/menu";
import { chapterMenu, setChaptersMeta } from "../../lib/binderActions";
import { Folder } from "lucide-react";
import { useLens, useNodeWords, type LensProps } from "./lens";

// 大纲列（Scrivener Outliner 移植）：章 = 行。点表头排序 = 视图透镜，只改展示不动 sort_key
// （正序循环：升 → 降 → 恢复目录序）。阶段 3A：列可选（梗概/标签/状态/字数/目标）、
// 标签与状态格直接点选修改、右键与侧栏同一套菜单、底部合计。

type SortKey = "order" | "title" | "label" | "status" | "words" | "target";
type OptCol = "synopsis" | "label" | "status" | "words" | "target";
const COLS_KEY = "bixian.outliner.cols";
const DEFAULT_COLS: OptCol[] = ["label", "status", "words", "target"];
const COL_LABEL: Record<OptCol, string> = { synopsis: "梗概", label: "标签", status: "状态", words: "字数", target: "目标" };

function readCols(): OptCol[] {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? "null");
    if (Array.isArray(v)) return v.filter((x): x is OptCol => x in COL_LABEL);
  } catch {
    // 忽略
  }
  return DEFAULT_COLS;
}

export function OutlinerTable(props: LensProps = {}) {
  const { chapters, reorder, onOpen } = useLens(props);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [asc, setAsc] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);
  const [cols, setCols] = useState<OptCol[]>(readCols);
  const wordsOf = useNodeWords();

  // 排序 = 透镜：永远基于目录序派生，不回写
  const rows = useMemo(() => {
    const list = [...chapters];
    const labelOf = (id: number | null) => labels.find((l) => l.id === id)?.sort_key ?? Number.MAX_SAFE_INTEGER;
    const statusOf = (id: number | null) => statuses.find((st) => st.id === id)?.sort_key ?? Number.MAX_SAFE_INTEGER;
    const collator = new Intl.Collator("zh");
    switch (sortKey) {
      case "title": list.sort((a, b) => collator.compare(a.title, b.title) * (asc ? 1 : -1)); break;
      case "label": list.sort((a, b) => (labelOf(a.label_id) - labelOf(b.label_id)) * (asc ? 1 : -1)); break;
      case "status": list.sort((a, b) => (statusOf(a.status_id) - statusOf(b.status_id)) * (asc ? 1 : -1)); break;
      case "words": list.sort((a, b) => (wordsOf(a) - wordsOf(b)) * (asc ? 1 : -1)); break;
      case "target": list.sort((a, b) => ((a.target_words ?? -1) - (b.target_words ?? -1)) * (asc ? 1 : -1)); break;
      default: break;
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, labels, statuses, sortKey, asc]);

  const headerClick = (key: SortKey) => {
    if (key === "order") { setSortKey("order"); return; }
    if (sortKey === key) {
      if (asc) { setAsc(false); }
      else { setSortKey("order"); setAsc(true); }
    } else {
      setSortKey(key);
      setAsc(true);
    }
  };

  const canDrag = sortKey === "order" && reorder != null;
  const drop = (targetId: number) => {
    if (canDrag && dragId != null && dragId !== targetId) {
      const ids = chapters.map((c) => c.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void reorder!(ids);
      }
    }
    setDragId(null);
  };

  const toggleCol = (c: OptCol) => {
    const next = cols.includes(c) ? cols.filter((x) => x !== c) : [...(Object.keys(COL_LABEL) as OptCol[])].filter((x) => x === c || cols.includes(x));
    setCols(next);
    try {
      localStorage.setItem(COLS_KEY, JSON.stringify(next));
    } catch {
      // 忽略
    }
  };

  if (chapters.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">还没有章节</div>;
  }

  const SortIcon = ({ colKey }: { colKey: SortKey }) => {
    if (sortKey !== colKey || colKey === "order") return null;
    return asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };
  const show = (c: OptCol) => cols.includes(c);
  const header = (key: SortKey, label: string, className: string) => (
    <button
      key={key}
      onClick={() => headerClick(key)}
      className={`${className} flex items-center ${key === "words" ? "justify-end" : "justify-start"} gap-0.5 transition-colors duration-150 hover:text-[color:var(--text-secondary)] ${
        sortKey === key ? "text-[color:var(--accent)]" : ""
      }`}
    >
      {label}
      <SortIcon colKey={key} />
    </button>
  );
  const totalWords = chapters.reduce((n, c) => n + wordsOf(c), 0);
  const targets = chapters.reduce((n, c) => n + (c.target_words ?? 0), 0);

  const pickMenu = (e: React.MouseEvent, ids: number[], kind: "label" | "status") => {
    e.stopPropagation();
    const items: MenuEntry[] =
      kind === "label"
        ? [...labels.map((l) => ({ label: l.title, swatch: l.color, onSelect: () => void setChaptersMeta(ids, { label_id: l.id }) })), { type: "separator" }, { label: "清除标签", onSelect: () => void setChaptersMeta(ids, { label_id: null }) }]
        : [...statuses.map((st) => ({ label: st.title, onSelect: () => void setChaptersMeta(ids, { status_id: st.id }) })), { type: "separator" }, { label: "清除状态", onSelect: () => void setChaptersMeta(ids, { status_id: null }) }];
    openMenuAt(e.currentTarget, items);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[var(--r-control)] [box-shadow:inset_0_0_0_1px_var(--hairline)]">
      <div className="flex shrink-0 items-center gap-2 bg-[var(--fill-element)] px-2 py-1.5 text-xs text-[color:var(--text-faint)]">
        <button onClick={() => headerClick("order")} title="恢复目录序" className={`w-8 shrink-0 text-left ${sortKey === "order" ? "text-[color:var(--accent)]" : ""}`}>
          序
        </button>
        {header("title", "标题", "min-w-0 flex-1")}
        {show("synopsis") && <span className="hidden min-w-0 flex-[1.4] @2xl:block">梗概</span>}
        {show("label") && header("label", "标签", "w-20 shrink-0")}
        {show("status") && header("status", "状态", "w-20 shrink-0")}
        {show("words") && header("words", "字数", "w-16 shrink-0 text-right")}
        {show("target") && header("target", "目标", "w-24 shrink-0")}
        <button
          aria-label="选择显示的列"
          data-tip="选择显示的列"
          onClick={(e) => openMenuAt(e.currentTarget, (Object.keys(COL_LABEL) as OptCol[]).map((c) => ({ label: COL_LABEL[c], checked: show(c), onSelect: () => toggleCol(c) })), "end")}
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
        >
          <Columns3 size={13} />
        </button>
      </div>
      <div className="@container flex-1 overflow-y-auto">
        {rows.map((c) => {
          const label = labels.find((l) => l.id === c.label_id) ?? null;
          const status = statuses.find((st) => st.id === c.status_id) ?? null;
          const words = wordsOf(c);
          const folder = c.kind === "folder";
          const progress =
            c.target_words != null && c.target_words > 0
              ? Math.min(100, Math.round((words / c.target_words) * 100))
              : null;
          const ids = [c.id];
          const active = currentChapterId === c.id;
          return (
            <div
              key={c.id}
              draggable={canDrag}
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => { if (canDrag) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); drop(c.id); }}
              onDragEnd={() => setDragId(null)}
              onClick={() => void useWorkspace.getState().selectChapter(c.id)}
              onDoubleClick={() => onOpen(c.id)}
              onContextMenu={(e) => openContextMenu(e, chapterMenu(ids))}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs transition-colors duration-150 ${
                active ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--fill-hover)]"
              } ${dragId === c.id ? "opacity-40" : ""}`}
            >
              <span className={`w-8 shrink-0 text-[color:var(--text-faint)] ${canDrag ? "cursor-grab" : ""}`} title={canDrag ? "拖拽换序" : undefined}>
                {chapters.indexOf(c) + 1}
              </span>
              {folder && <Folder size={12} className="-mr-1 shrink-0 text-[color:var(--accent)]" />}
              <span className={`min-w-0 flex-1 truncate text-[color:var(--text-primary)] ${folder ? "font-medium" : ""}`}>{c.title}</span>
              {show("synopsis") && (
                <span className="hidden min-w-0 flex-[1.4] truncate text-[color:var(--text-faint)] @2xl:block" title={c.synopsis}>
                  {c.synopsis || "—"}
                </span>
              )}
              {show("label") && (
                <button onClick={(e) => pickMenu(e, ids, "label")} onDoubleClick={(e) => e.stopPropagation()} className="w-20 shrink-0 truncate rounded text-left hover:bg-[var(--fill-hover)]">
                  {label ? (
                    <span className="inline-flex items-center gap-1" style={{ color: label.color }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                      {label.title}
                    </span>
                  ) : (
                    <span className="text-[color:var(--text-faint)]">—</span>
                  )}
                </button>
              )}
              {show("status") && (
                <button onClick={(e) => pickMenu(e, ids, "status")} onDoubleClick={(e) => e.stopPropagation()} className="w-20 shrink-0 truncate rounded text-left text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)]">
                  {status?.title ?? "—"}
                </button>
              )}
              {show("words") && <span className="w-16 shrink-0 text-right tabular-nums text-[color:var(--text-secondary)]">{words}</span>}
              {show("target") && (
                <span className="flex w-24 shrink-0 items-center gap-1.5">
                  {progress != null ? (
                    <>
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--fill-element)]">
                        <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progress}%` }} />
                      </div>
                      <span className="w-8 text-right text-[color:var(--text-faint)]">{progress}%</span>
                    </>
                  ) : (
                    <span className="text-[color:var(--text-faint)]">—</span>
                  )}
                </span>
              )}
              <span className="w-[17px] shrink-0" />
            </div>
          );
        })}
      </div>
      <div className="flex shrink-0 items-center gap-3 px-3 py-1.5 text-2xs text-[color:var(--text-faint)] [box-shadow:inset_0_1px_0_var(--hairline)]">
        <span>共 {chapters.filter((c) => c.kind !== "folder").length} 章{chapters.some((c) => c.kind === "folder") ? ` · ${chapters.filter((c) => c.kind === "folder").length} 卷` : ""}</span>
        <span className="tabular-nums">{totalWords.toLocaleString()} 字</span>
        {targets > 0 && <span className="tabular-nums">目标 {targets.toLocaleString()} 字 · {Math.min(100, Math.round((totalWords / targets) * 100))}%</span>}
        {reorder == null && <span className="ml-auto">只读</span>}
      </div>
    </div>
  );
}
