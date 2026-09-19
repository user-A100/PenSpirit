import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen } from "lucide-react";
import type { ChapterMeta } from "../../lib/tauri";

// 左面板：目录（books-reader NavigationPanel 的 Bixian 化）。
// 平铺章节列表 + 当前章高亮 + 自动滚到当前章 + 标题子串过滤（不区分大小写）。

interface NavPanelProps {
  bookTitle: string;
  chapters: ChapterMeta[];
  currentChapterId: number | null;
  onSelectChapter: (id: number) => void;
  /** 面板是否展开（默认 true）；重新展开时再次滚到当前章 */
  active?: boolean;
}

export function NavPanel({ bookTitle, chapters, currentChapterId, onSelectChapter, active = true }: NavPanelProps) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLUListElement | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter((c) => c.title.toLowerCase().includes(q));
  }, [chapters, query]);

  // 目录滚到当前章（面板常驻挂载，展开/切章/过滤后都会走到这里）
  useEffect(() => {
    if (!active) return;
    const el = listRef.current?.querySelector("[data-current='true']");
    el?.scrollIntoView?.({ block: "center" });
  }, [active, currentChapterId, query]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pb-2 pt-4 pr-10">
        <BookOpen size={16} className="shrink-0 opacity-60" />
        <div className="min-w-0 truncate text-sm font-medium" title={bookTitle}>
          {bookTitle}
        </div>
      </div>
      <div className="px-4 pb-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="过滤章节…"
          className="w-full rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-1 text-xs outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]"
        />
      </div>
      <ul ref={listRef} className="read-nav-list min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {filtered.map((c) => (
          <li
            key={c.id}
            data-current={c.id === currentChapterId ? "true" : undefined}
            onClick={() => onSelectChapter(c.id)}
            className="cursor-pointer truncate rounded px-2 py-1.5 text-xs"
            title={c.title}
          >
            {c.title}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-2 py-3 text-center text-xs text-[var(--text-faint)]">无匹配章节</li>
        )}
      </ul>
      <div className="border-t border-[var(--border-subtle)] px-4 py-2 text-[11px] text-[var(--text-faint)]">
        本书 {chapters.length} 章
      </div>
    </div>
  );
}
