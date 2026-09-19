import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ChapterMeta } from "../../lib/tauri";

// 底栏（450×60）：进度滑条（章粒度，拖动即换章）+「第 X / N 章」+ 上一章/下一章。

interface BottomPanelProps {
  chapters: ChapterMeta[];
  currentChapterId: number | null;
  onSelectChapter: (id: number) => void;
  onPrev: () => void;
  onNext: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
}

export function BottomPanel({
  chapters,
  currentChapterId,
  onSelectChapter,
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
}: BottomPanelProps) {
  const total = chapters.length;
  const idx = chapters.findIndex((c) => c.id === currentChapterId);
  const current = idx >= 0 ? idx + 1 : 0;

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
      <span className="shrink-0 tabular-nums opacity-70">{total > 0 ? `第 ${Math.max(current, 1)} / ${total} 章` : "无章节"}</span>
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
