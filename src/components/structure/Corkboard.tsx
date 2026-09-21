import { useState } from "react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useUiNav } from "../../lib/nav/uiStore";
import type { ChapterMeta } from "../../lib/tauri";

// 卡片墙（Scrivener Corkboard 移植）：章 = 卡，显示梗概/标签/状态/字数。
// 拖拽换序（落 sort_key，与侧栏同源）；单击选中，双击进写作视图。

function Card({ ch, active, dragging, over }: { ch: ChapterMeta; active: boolean; dragging: boolean; over: boolean }) {
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const label = labels.find((l) => l.id === ch.label_id) ?? null;
  const status = statuses.find((st) => st.id === ch.status_id) ?? null;
  const progress =
    ch.target_words != null && ch.target_words > 0
      ? Math.min(100, Math.round((ch.word_count / ch.target_words) * 100))
      : null;
  return (
    <div
      className={`flex h-full cursor-grab flex-col gap-1.5 rounded-md border p-2.5 transition-colors duration-150 active:cursor-grabbing ${
        active
          ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
          : "border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] hover:border-[color:var(--accent)]"
      } ${dragging ? "opacity-40" : ""} ${over ? "ring-2 ring-[color:var(--accent)]" : ""}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {label && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} title={label.title} />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]">{ch.title}</span>
        {status && (
          <span className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[color:var(--text-secondary)]" style={{ backgroundColor: "var(--bg-hover)" }}>
            {status.title}
          </span>
        )}
      </div>
      <p className="line-clamp-4 flex-1 text-xs leading-relaxed text-[color:var(--text-secondary)]">
        {ch.synopsis || <span className="text-[color:var(--text-faint)]">（无梗概）</span>}
      </p>
      <div className="flex items-center gap-2 text-[10px] text-[color:var(--text-faint)]">
        <span>{ch.word_count} 字</span>
        {progress != null && (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--bg-panel)]">
              <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}%</span>
          </>
        )}
      </div>
    </div>
  );
}

export function Corkboard() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selectChapter = useWorkspace((s) => s.selectChapter);
  const reorderChapters = useWorkspace((s) => s.reorderChapters);
  const setView = useUiNav((s) => s.setView);
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);

  if (chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">
        还没有章节——在侧栏或「从模板新建」里建第一章
      </div>
    );
  }

  const drop = (targetId: number) => {
    if (dragId != null && dragId !== targetId) {
      const ids = chapters.map((c) => c.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void reorderChapters(ids);
      }
    }
    setDragId(null);
    setOverId(null);
  };

  return (
    <div className="grid content-start gap-3 [grid-template-columns:repeat(auto-fill,minmax(180px,1fr))]">
      {chapters.map((c) => (
        <div
          key={c.id}
          draggable
          onDragStart={() => setDragId(c.id)}
          onDragOver={(e) => {
            e.preventDefault();
            setOverId(c.id);
          }}
          onDragLeave={() => setOverId((v) => (v === c.id ? null : v))}
          onDrop={(e) => {
            e.preventDefault();
            drop(c.id);
          }}
          onDragEnd={() => {
            setDragId(null);
            setOverId(null);
          }}
          onClick={() => void selectChapter(c.id)}
          onDoubleClick={() => {
            void selectChapter(c.id);
            setView("write");
          }}
          title="拖拽换序 · 双击进写作"
          className="h-32"
        >
          <Card ch={c} active={currentChapterId === c.id} dragging={dragId === c.id} over={overId === c.id && dragId !== c.id} />
        </div>
      ))}
    </div>
  );
}
