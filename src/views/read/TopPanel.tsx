import { useEffect, useState } from "react";
import { LogOut, Maximize, Minimize } from "lucide-react";

// 顶栏（450×60）：书名/章名、本次阅读时长 mm:ss（1s tick）、全书进度百分比、
// 全屏切换与退出。进度经 progressRef 轮询（避免正文滚动路径上的重渲染）。

interface TopPanelProps {
  bookTitle: string;
  chapterTitle: string;
  /** 本次进入阅读的时刻（ms 时间戳） */
  startedAt: number;
  /** 最新滚动比例 0-1（ReadView 滚动时同步写入） */
  progressRef: { current: number };
  onExit: () => void;
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, "0")}`;
}

export function TopPanel({ bookTitle, chapterTitle, startedAt, progressRef, onExit }: TopPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const [fullscreen, setFullscreen] = useState(() => Boolean(document.fullscreenElement));

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      // 全屏 API 不可用（权限/环境）时静默
    }
  };

  const pct = Math.round(Math.min(1, Math.max(0, progressRef.current)) * 100);

  return (
    <div className="flex h-full w-full items-center gap-3 px-4 text-xs">
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate opacity-70" title={bookTitle}>
          {bookTitle}
        </div>
        <div className="truncate" title={chapterTitle}>
          {chapterTitle}
        </div>
      </div>
      <span className="tabular-nums opacity-70" title="本次阅读时长">
        {fmtDuration(now - startedAt)}
      </span>
      <span className="tabular-nums opacity-70" title="本章进度">
        {pct}%
      </span>
      <button
        onClick={toggleFullscreen}
        title={fullscreen ? "退出全屏" : "全屏"}
        className="flex h-7 w-7 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
      >
        {fullscreen ? <Minimize size={14} /> : <Maximize size={14} />}
      </button>
      <button
        onClick={onExit}
        title="退出阅读（Esc）"
        className="flex h-7 w-7 items-center justify-center rounded-md opacity-70 transition-opacity hover:opacity-100"
      >
        <LogOut size={14} />
      </button>
    </div>
  );
}
