import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChapterMeta } from "../../lib/tauri";

// 底栏（450×60）：进度滑条（章粒度，拖动即换章）+「第 X / N 章 · P/M 页」+ 上一章/下一章。
// 页码为视口伪分页（作家助手三公式），ReadView 滚动时写入 pageRef，这里 300ms 轮询
// （面板常挂载在壳层，未滚动的静置期读到的是同值 → setState bail，零额外渲染）。

interface BottomPanelProps {
  chapters: ChapterMeta[];
  currentChapterId: number | null;
  onSelectChapter: (id: number) => void;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  pageRef: { current: { page: number; total: number } };
}

export function BottomPanel({
  chapters,
  currentChapterId,
  onSelectChapter,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
  pageRef,
}: BottomPanelProps) {
  const total = chapters.length;
  const idx = chapters.findIndex((c) => c.id === currentChapterId);
  const current = idx >= 0 ? idx + 1 : 0;
  // 初值直接读 ref：面板唤出的第一帧就是当前页，不等首个轮询周期
  const [pg, setPg] = useState(() => ({ ...pageRef.current }));

  useEffect(() => {
    const t = window.setInterval(() => {
      const p = pageRef.current;
      setPg((prev) => (prev.page === p.page && prev.total === p.total ? prev : { ...p }));
    }, 300);
    return () => window.clearInterval(t);
  }, [pageRef]);

  const onSlide = (v: number) => {
    const c = chapters[v - 1];
    if (c && c.id !== currentChapterId) onSelectChapter(c.id);
  };

  return (
    <div className="flex h-full w-full items-center gap-3 px-4 text-xs">
      <button
        onClick={onPrev}
        disabled={prevDisabled}
        title="上一章（Ctrl+←）"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-25"
      >
        <ChevronLeft size={15} />
      </button>
      <span className="shrink-0 tabular-nums opacity-70">
        {total > 0 ? `第 ${Math.max(current, 1)} / ${total} 章 · ${pg.page}/${pg.total} 页` : "无章节"}
      </span>
      <input
        type="range"
        role="slider"
        min={1}
        max={Math.max(total, 1)}
        step={1}
        value={Math.max(current, 1)}
        disabled={total === 0}
        onChange={(e) => onSlide(Number(e.target.value))}
        className="read-progress-slider min-w-0 flex-1"
        title="拖动跳章"
      />
      <button
        onClick={onNext}
        disabled={nextDisabled}
        title="下一章（Ctrl+→）"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-25"
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
