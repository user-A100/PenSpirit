import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Grid3x3, Move } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useUiNav } from "../../lib/nav/uiStore";
import { api, type ChapterMeta } from "../../lib/tauri";
import { freeformCommitOrder } from "../../lib/freeform";

// 卡片墙（Scrivener Corkboard 移植）：章 = 卡，显示梗概/标签/状态/字数。
// 两种摆法：排序网格（拖拽换序，落 sort_key）与自由摆位（M7 批次7，坐标落
// chapters.freeform_x/y，与目录序解耦；「落序」按钮按视觉位置行主序重排目录）。
// 单击选中，双击进写作视图。

const CARD_W = 180;
const CARD_H = 128;
const GAP = 12;
const MODE_KEY = "bixian.corkboardMode";
type BoardMode = "grid" | "freeform";

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
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selectChapter = useWorkspace((s) => s.selectChapter);
  const reorderChapters = useWorkspace((s) => s.reorderChapters);
  const setView = useUiNav((s) => s.setView);
  const [mode, setMode] = useState<BoardMode>(() => (localStorage.getItem(MODE_KEY) === "freeform" ? "freeform" : "grid"));
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  // 自由摆位：chapter_id → 已落库/拖动中的坐标；缺席者按索引流式排布（不落库）
  const [positions, setPositions] = useState<Map<number, { x: number; y: number }>>(new Map());
  const grabRef = useRef({ dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (mode !== "freeform" || currentBookId == null) return;
    api
      .freeformPositions(currentBookId)
      .then((ps) => {
        setPositions(new Map(ps.filter((p) => p.x !== 0 || p.y !== 0).map((p) => [p.chapter_id, { x: p.x, y: p.y }])));
      })
      .catch(console.warn);
  }, [mode, currentBookId]);

  if (chapters.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">
        还没有章节——在侧栏或「从模板新建」里建第一章
      </div>
    );
  }

  const pickMode = (m: BoardMode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, m);
  };

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

  // ---- 自由摆位 ----
  const flow = (i: number) => ({ x: (i % 4) * (CARD_W + GAP), y: Math.floor(i / 4) * (CARD_H + GAP) });
  const posOf = (id: number, idx: number) => positions.get(id) ?? flow(idx);

  const persistPos = (id: number, x: number, y: number) => {
    void api.freeformPositionSet(id, x, y).catch(console.warn);
  };

  const freeformDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragId == null) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    const nx = Math.max(0, e.clientX - (rect?.left ?? 0) - grabRef.current.dx);
    const ny = Math.max(0, e.clientY - (rect?.top ?? 0) - grabRef.current.dy);
    setPositions((prev) => new Map(prev).set(dragId, { x: nx, y: ny }));
  };

  const freeformDragEnd = () => {
    if (dragId != null) {
      const p = positions.get(dragId);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) persistPos(dragId, p.x, p.y);
    }
    setDragId(null);
  };

  const commitOrder = () => {
    const ps = chapters.map((c, i) => {
      const p = posOf(c.id, i);
      return { chapter_id: c.id, x: p.x, y: p.y };
    });
    void reorderChapters(freeformCommitOrder(chapters, ps));
  };

  const modeButtons = (
    <div className="flex items-center gap-0.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
      <button
        onClick={() => pickMode("grid")}
        title="拖拽换序 · 落目录序"
        data-testid="corkboard-mode-grid"
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 ${
          mode === "grid" ? "bg-[var(--accent-dim)] text-[color:var(--accent)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
        }`}
      >
        <Grid3x3 size={13} />
        排序网格
      </button>
      <button
        onClick={() => pickMode("freeform")}
        title="自由摆位 · 与目录序解耦"
        data-testid="corkboard-mode-freeform"
        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 ${
          mode === "freeform" ? "bg-[var(--accent-dim)] text-[color:var(--accent)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
        }`}
      >
        <Move size={13} />
        自由摆位
      </button>
    </div>
  );

  if (mode === "grid") {
    return (
      <div className="flex h-full flex-col gap-2">
        {modeButtons}
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
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        {modeButtons}
        <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">
          拖卡片随意摆 · 摆位不改动目录序，想按位置重排时点「落序」
        </span>
        <button
          onClick={commitOrder}
          title="把当前摆位按视觉行列转成章节顺序（行主序）"
          data-testid="corkboard-commit"
          className="flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
        >
          <ArrowDownToLine size={13} />
          落序
        </button>
      </div>
      <div
        ref={canvasRef}
        onDragOver={freeformDragOver}
        onDrop={(e) => {
          e.preventDefault();
          freeformDragEnd();
        }}
        data-testid="corkboard-freeform-canvas"
        className="relative min-h-0 flex-1 overflow-auto rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]"
        style={{ minHeight: Math.ceil(chapters.length / 4) * (CARD_H + GAP) + GAP }}
      >
        {chapters.map((c, i) => {
          const p = posOf(c.id, i);
          return (
            <div
              key={c.id}
              draggable
              onDragStart={(e) => {
                const rect = canvasRef.current?.getBoundingClientRect();
                grabRef.current = { dx: e.clientX - ((rect?.left ?? 0) + p.x), dy: e.clientY - ((rect?.top ?? 0) + p.y) };
                e.dataTransfer?.setData("text/plain", String(c.id));
                setDragId(c.id);
              }}
              onDragEnd={freeformDragEnd}
              onClick={() => void selectChapter(c.id)}
              onDoubleClick={() => {
                void selectChapter(c.id);
                setView("write");
              }}
              title="拖拽摆位 · 双击进写作"
              className={`absolute ${dragId === c.id ? "opacity-60" : ""}`}
              style={{ left: p.x, top: p.y, width: CARD_W, height: CARD_H }}
            >
              <Card ch={c} active={currentChapterId === c.id} dragging={false} over={false} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
