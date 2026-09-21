import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useUiNav } from "../../lib/nav/uiStore";

// 大纲列（Scrivener Outliner 移植）：章 = 行，标题/标签/状态/字数/目标/进度列。
// 点表头排序 = 视图透镜，只改展示不动 sort_key（正序循环：升 → 降 → 恢复目录序）。

type SortKey = "order" | "title" | "label" | "status" | "words" | "target";

const COLS: { key: SortKey; label: string; className: string }[] = [
  { key: "title", label: "标题", className: "min-w-0 flex-1" },
  { key: "label", label: "标签", className: "w-20 shrink-0" },
  { key: "status", label: "状态", className: "w-20 shrink-0" },
  { key: "words", label: "字数", className: "w-16 shrink-0 text-right" },
  { key: "target", label: "目标", className: "w-24 shrink-0" },
];

export function OutlinerTable() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selectChapter = useWorkspace((s) => s.selectChapter);
  const reorderChapters = useWorkspace((s) => s.reorderChapters);
  const setView = useUiNav((s) => s.setView);
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const [sortKey, setSortKey] = useState<SortKey>("order");
  const [asc, setAsc] = useState(true);
  const [dragId, setDragId] = useState<number | null>(null);

  // 排序 = 透镜：永远基于 chapters 目录序派生，不回写
  const rows = useMemo(() => {
    const list = [...chapters];
    const labelOf = (id: number | null) => labels.find((l) => l.id === id)?.sort_key ?? Number.MAX_SAFE_INTEGER;
    const statusOf = (id: number | null) => statuses.find((st) => st.id === id)?.sort_key ?? Number.MAX_SAFE_INTEGER;
    const collator = new Intl.Collator("zh");
    switch (sortKey) {
      case "title": list.sort((a, b) => collator.compare(a.title, b.title) * (asc ? 1 : -1)); break;
      case "label": list.sort((a, b) => (labelOf(a.label_id) - labelOf(b.label_id)) * (asc ? 1 : -1)); break;
      case "status": list.sort((a, b) => (statusOf(a.status_id) - statusOf(b.status_id)) * (asc ? 1 : -1)); break;
      case "words": list.sort((a, b) => (a.word_count - b.word_count) * (asc ? 1 : -1)); break;
      case "target": list.sort((a, b) => ((a.target_words ?? -1) - (b.target_words ?? -1)) * (asc ? 1 : -1)); break;
      default: break;
    }
    return list;
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

  const drop = (targetId: number) => {
    if (dragId != null && dragId !== targetId && sortKey === "order") {
      const ids = chapters.map((c) => c.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void reorderChapters(ids);
      }
    }
    setDragId(null);
  };

  if (chapters.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">还没有章节</div>;
  }

  const SortIcon = ({ colKey }: { colKey: SortKey }) => {
    if (sortKey !== colKey || colKey === "order") return null;
    return asc ? <ArrowUp size={11} /> : <ArrowDown size={11} />;
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-[color:var(--border-subtle)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[color:var(--text-faint)]">
        <button onClick={() => headerClick("order")} title="恢复目录序" className={`w-8 shrink-0 ${sortKey === "order" ? "text-[color:var(--accent)]" : ""}`}>
          <SortIcon colKey="order" />
          {sortKey === "order" ? "序" : "序"}
        </button>
        {COLS.map((col) => (
          <button
            key={col.key}
            onClick={() => headerClick(col.key)}
            className={`${col.className} flex items-center ${col.key === "words" ? "justify-end" : "justify-start"} gap-0.5 transition-colors duration-150 hover:text-[color:var(--text-secondary)] ${
              sortKey === col.key ? "text-[color:var(--accent)]" : ""
            }`}
          >
            {col.label}
            <SortIcon colKey={col.key} />
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows.map((c) => {
          const label = labels.find((l) => l.id === c.label_id) ?? null;
          const status = statuses.find((st) => st.id === c.status_id) ?? null;
          const progress =
            c.target_words != null && c.target_words > 0
              ? Math.min(100, Math.round((c.word_count / c.target_words) * 100))
              : null;
          return (
            <div
              key={c.id}
              draggable={sortKey === "order"}
              onDragStart={() => setDragId(c.id)}
              onDragOver={(e) => { if (sortKey === "order") e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); drop(c.id); }}
              onDragEnd={() => setDragId(null)}
              onClick={() => void selectChapter(c.id)}
              onDoubleClick={() => {
                void selectChapter(c.id);
                setView("write");
              }}
              className={`flex cursor-pointer items-center gap-2 px-2 py-1.5 text-xs transition-colors duration-150 ${
                currentChapterId === c.id ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-hover)]"
              } ${dragId === c.id ? "opacity-40" : ""}`}
            >
              <span className={`w-8 shrink-0 text-[color:var(--text-faint)] ${sortKey === "order" ? "cursor-grab" : ""}`} title={sortKey === "order" ? "拖拽换序" : undefined}>
                {chapters.indexOf(c) + 1}
              </span>
              <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{c.title}</span>
              <span className="w-20 shrink-0 truncate">
                {label ? (
                  <span className="inline-flex items-center gap-1" style={{ color: label.color }}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: label.color }} />
                    {label.title}
                  </span>
                ) : (
                  <span className="text-[color:var(--text-faint)]">—</span>
                )}
              </span>
              <span className="w-20 shrink-0 truncate text-[color:var(--text-secondary)]">{status?.title ?? "—"}</span>
              <span className="w-16 shrink-0 text-right text-[color:var(--text-secondary)]">{c.word_count}</span>
              <span className="flex w-24 shrink-0 items-center gap-1.5">
                {progress != null ? (
                  <>
                    <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                      <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="w-8 text-right text-[color:var(--text-faint)]">{progress}%</span>
                  </>
                ) : (
                  <span className="text-[color:var(--text-faint)]">—</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
