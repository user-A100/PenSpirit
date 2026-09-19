import { useEffect } from "react";
import { useStats } from "../../stores/stats";
import { useWorkspace } from "../../stores/workspace";

// M2-T11 侧栏底部「今日 N 字」徽章。只统计当前书的当日增量。
export function StatsBadge() {
  const bookId = useWorkspace((s) => s.currentBookId);
  const words = useStats((s) => s.words);
  const activeMinutes = useStats((s) => s.activeMinutes);
  const load = useStats((s) => s.load);

  useEffect(() => {
    void load(bookId);
  }, [bookId, load]);

  if (bookId == null) return null;

  return (
    <div
      title={`今日 ${words.toLocaleString()} 字 · 活跃 ${activeMinutes} 分钟`}
      className="px-2 pb-1.5 text-center text-[11px] text-[color:var(--text-faint)]"
    >
      今日 <span className="text-[color:var(--text-secondary)]">{words.toLocaleString()}</span> 字
    </div>
  );
}
