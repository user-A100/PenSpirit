import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Grid3x3, Move, Pencil } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { openContextMenu } from "../../stores/menu";
import { chapterMenu, setChaptersMeta } from "../../lib/binderActions";
import { api, type ChapterMeta } from "../../lib/tauri";
import { freeformCommitOrder } from "../../lib/freeform";
import { useLens, type LensProps } from "./lens";

// 卡片墙（Scrivener Corkboard 移植）：章 = 卡，显示梗概/标签/状态/字数/目标进度。
// 两种摆法：排序网格（拖拽换序，落 sort_key）与自由摆位（坐标落 chapters.freeform_x/y，
// 与目录序解耦；「落序」按视觉位置行主序重排）。阶段 3A：卡片三档尺寸、左缘标签色条、
// 悬停「编辑梗概」原地改、方向键在卡片间移动 / Enter 打开、右键与侧栏同一套菜单。

const SIZES = {
  s: { w: 160, h: 112, cls: "h-28", min: 150 },
  m: { w: 180, h: 128, cls: "h-32", min: 180 },
  l: { w: 260, h: 176, cls: "h-44", min: 240 },
} as const;
type Size = keyof typeof SIZES;
const GAP = 12;
const MODE_KEY = "bixian.corkboardMode";
const SIZE_KEY = "bixian.corkboardSize";
type BoardMode = "grid" | "freeform";

function SynopsisEditor({ ch, onDone }: { ch: ChapterMeta; onDone: () => void }) {
  const [v, setV] = useState(ch.synopsis);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = async () => {
    onDone();
    if (v === ch.synopsis) return;
    try {
      const meta = await api.chapterUpdateMeta(ch.id, { synopsis: v });
      useWorkspace.setState((s) => ({ chapters: s.chapters.map((c) => (c.id === ch.id ? { ...c, ...meta } : c)) }));
    } catch {
      // 失败保持原梗概（store 未改）
    }
  };
  return (
    <textarea
      ref={ref}
      value={v}
      aria-label="编辑梗概"
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void save();
        } else if (e.key === "Escape") onDone();
      }}
      onBlur={() => void save()}
      placeholder="一两句话写这一章发生了什么"
      className="flex-1 resize-none rounded-[4px] border border-[color:var(--accent)] bg-[var(--bg-panel)] p-1 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none"
    />
  );
}

function Card({ ch, active, dragging, over, editing, onEdit }: { ch: ChapterMeta; active: boolean; dragging: boolean; over: boolean; editing: boolean; onEdit: (v: boolean) => void }) {
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
      className={`group/card relative flex h-full cursor-grab flex-col gap-1.5 overflow-hidden rounded-[var(--r-control)] border p-2.5 pl-3 transition-[border-color,box-shadow,background-color] duration-[var(--dur-md)] active:cursor-grabbing ${
        active
          ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
          : "border-[color:var(--hairline)] bg-[var(--bg-elevated)] hover:border-[color:color-mix(in_srgb,var(--accent)_60%,transparent)]"
      } ${dragging ? "opacity-40" : ""} ${over ? "ring-2 ring-[color:var(--accent)]" : ""}`}
    >
      {/* 左缘标签色条（Scrivener 卡片标签色） */}
      {label && <span aria-hidden className="absolute bottom-0 left-0 top-0 w-[3px]" style={{ backgroundColor: label.color }} />}
      <div className="flex min-w-0 items-center gap-1.5">
        {label && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} title={label.title} />}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]">{ch.title}</span>
        {status && (
          <span className="shrink-0 rounded px-1 py-0.5 text-2xs text-[color:var(--text-secondary)]" style={{ backgroundColor: "var(--fill-element)" }}>
            {status.title}
          </span>
        )}
      </div>
      {editing ? (
        <SynopsisEditor ch={ch} onDone={() => onEdit(false)} />
      ) : (
        <div className="relative min-h-0 flex-1">
          <p className="line-clamp-4 text-xs leading-relaxed text-[color:var(--text-secondary)]">
            {ch.synopsis || <span className="text-[color:var(--text-faint)]">（无梗概）</span>}
          </p>
          <button
            aria-label={`编辑「${ch.title}」的梗概`}
            data-tip="编辑梗概"
            onClick={(e) => {
              e.stopPropagation();
              onEdit(true);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute bottom-0 right-0 rounded-[4px] bg-[var(--bg-elevated)] p-1 text-[color:var(--text-faint)] opacity-0 transition-opacity hover:text-[color:var(--text-primary)] group-hover/card:opacity-100 focus-visible:opacity-100"
          >
            <Pencil size={11} />
          </button>
        </div>
      )}
      <div className="flex items-center gap-2 text-2xs text-[color:var(--text-faint)]">
        <span>{ch.word_count} 字</span>
        {progress != null && (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--fill-element)]">
              <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}%</span>
          </>
        )}
      </div>
    </div>
  );
}

export function Corkboard(props: LensProps = {}) {
  const { chapters, reorder, onOpen, allowFreeform } = useLens(props);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const [mode, setMode] = useState<BoardMode>(() => (localStorage.getItem(MODE_KEY) === "freeform" ? "freeform" : "grid"));
  const [size, setSize] = useState<Size>(() => {
    const v = localStorage.getItem(SIZE_KEY);
    return v === "s" || v === "l" ? v : "m";
  });
  const [dragId, setDragId] = useState<number | null>(null);
  const [overId, setOverId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  // 自由摆位：chapter_id → 已落库/拖动中的坐标；缺席者按索引流式排布（不落库）
  const [positions, setPositions] = useState<Map<number, { x: number; y: number }>>(new Map());
  const grabRef = useRef({ dx: 0, dy: 0 });
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const effectiveMode: BoardMode = allowFreeform ? mode : "grid";
  const dims = SIZES[size];

  useEffect(() => {
    if (effectiveMode !== "freeform" || currentBookId == null) return;
    api
      .freeformPositions(currentBookId)
      .then((ps) => {
        setPositions(new Map(ps.filter((p) => p.x !== 0 || p.y !== 0).map((p) => [p.chapter_id, { x: p.x, y: p.y }])));
      })
      .catch(console.warn);
  }, [effectiveMode, currentBookId]);

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
  const pickSize = (s: Size) => {
    setSize(s);
    localStorage.setItem(SIZE_KEY, s);
  };

  const drop = (targetId: number) => {
    if (reorder && dragId != null && dragId !== targetId) {
      const ids = chapters.map((c) => c.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from >= 0 && to >= 0) {
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        void reorder(ids);
      }
    }
    setDragId(null);
    setOverId(null);
  };

  // 组视图里整组都在选区内，右键只作用于这张卡（批量操作走 Binder 多选）
  const menuFor = (e: React.MouseEvent, id: number) => openContextMenu(e, chapterMenu([id]));

  // 方向键在卡片间移动（按网格实际列数），Enter 打开
  const onGridKey = (e: React.KeyboardEvent) => {
    if (editingId != null) return;
    const ids = chapters.map((c) => c.id);
    const cur = focusId != null && ids.includes(focusId) ? ids.indexOf(focusId) : ids.indexOf(currentChapterId ?? -1);
    const width = gridRef.current?.clientWidth ?? 600;
    const cols = Math.max(1, Math.floor((width + GAP) / (dims.min + GAP)));
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols } as Record<string, number>;
    if (e.key in step) {
      e.preventDefault();
      const next = Math.max(0, Math.min(ids.length - 1, (cur < 0 ? 0 : cur) + step[e.key]));
      setFocusId(ids[next]);
      (gridRef.current?.querySelector(`[data-card="${ids[next]}"]`) as HTMLElement | null)?.focus();
    } else if (e.key === "Enter" && cur >= 0) {
      e.preventDefault();
      onOpen(ids[cur]);
    }
  };

  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {allowFreeform && (
        <div className="flex items-center gap-0.5 rounded-[var(--r-control)] bg-[var(--fill-element)] p-0.5">
          <button
            onClick={() => pickMode("grid")}
            title="拖拽换序 · 落目录序"
            data-testid="corkboard-mode-grid"
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 ${
              effectiveMode === "grid" ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
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
              effectiveMode === "freeform" ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
            }`}
          >
            <Move size={13} />
            自由摆位
          </button>
        </div>
      )}
      {effectiveMode === "grid" && (
        <div className="flex items-center gap-0.5 rounded-[var(--r-control)] bg-[var(--fill-element)] p-0.5 text-xs" aria-label="卡片尺寸">
          {(["s", "m", "l"] as Size[]).map((s) => (
            <button
              key={s}
              onClick={() => pickSize(s)}
              aria-pressed={size === s}
              className={`rounded px-2 py-1 transition-colors ${size === s ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]"}`}
            >
              {s === "s" ? "小" : s === "m" ? "中" : "大"}
            </button>
          ))}
        </div>
      )}
      {reorder == null && <span className="text-xs text-[color:var(--text-faint)]">只读（搜索集合按目录序）</span>}
    </div>
  );

  if (effectiveMode === "grid") {
    return (
      <div className="flex h-full flex-col gap-2">
        {toolbar}
        <div
          ref={gridRef}
          onKeyDown={onGridKey}
          className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto pb-1"
          style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${dims.min}px,1fr))` }}
        >
          {chapters.map((c) => (
            <div
              key={c.id}
              data-card={c.id}
              tabIndex={0}
              draggable={reorder != null && editingId !== c.id}
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
              onFocus={() => setFocusId(c.id)}
              onClick={() => void useWorkspace.getState().selectChapter(c.id)}
              onDoubleClick={() => onOpen(c.id)}
              onContextMenu={(e) => menuFor(e, c.id)}
              title={reorder ? "拖拽换序 · 双击打开 · 右键更多" : "双击打开"}
              className={`${dims.cls} rounded-[var(--r-control)] outline-none focus-visible:[box-shadow:var(--focus-ring)]`}
            >
              <Card
                ch={c}
                active={currentChapterId === c.id}
                dragging={dragId === c.id}
                over={overId === c.id && dragId !== c.id}
                editing={editingId === c.id}
                onEdit={(v) => setEditingId(v ? c.id : null)}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- 自由摆位 ----
  const flow = (i: number) => ({ x: (i % 4) * (SIZES.m.w + GAP), y: Math.floor(i / 4) * (SIZES.m.h + GAP) });
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
    if (!reorder) return;
    const ps = chapters.map((c, i) => {
      const p = posOf(c.id, i);
      return { chapter_id: c.id, x: p.x, y: p.y };
    });
    void reorder(freeformCommitOrder(chapters, ps));
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        {toolbar}
        <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">
          拖卡片随意摆 · 摆位不改动目录序，想按位置重排时点「落序」
        </span>
        <button
          onClick={commitOrder}
          title="把当前摆位按视觉行列转成章节顺序（行主序）"
          data-testid="corkboard-commit"
          className="flex shrink-0 items-center gap-1 rounded-[var(--r-control)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 [box-shadow:inset_0_0_0_1px_var(--hairline)] hover:text-[color:var(--text-primary)]"
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
        className="relative min-h-0 flex-1 overflow-auto rounded-[var(--r-control)] bg-[var(--fill-element)]"
        style={{ minHeight: Math.ceil(chapters.length / 4) * (SIZES.m.h + GAP) + GAP }}
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
              onClick={() => void useWorkspace.getState().selectChapter(c.id)}
              onDoubleClick={() => onOpen(c.id)}
              onContextMenu={(e) => menuFor(e, c.id)}
              title="拖拽摆位 · 双击打开"
              className={`absolute ${dragId === c.id ? "opacity-60" : ""}`}
              style={{ left: p.x, top: p.y, width: SIZES.m.w, height: SIZES.m.h }}
            >
              <Card ch={c} active={currentChapterId === c.id} dragging={false} over={false} editing={editingId === c.id} onEdit={(v) => setEditingId(v ? c.id : null)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// 供大纲列等复用的批量元数据入口（避免循环依赖时的直接导入）
export { setChaptersMeta };
