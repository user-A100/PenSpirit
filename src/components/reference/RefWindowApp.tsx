import { useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { api, type ChapterMeta } from "../../lib/tauri";
import { ThemeProvider } from "../../themes/ThemeProvider";
import { countWords } from "../../lib/words";

// 参考浮窗（M7 批次7）：主窗 ?refwindow 检测后独立渲染的轻量应用——
// 只有章下拉 + 只读正文，不带 Ribbon/侧栏/编辑器。书在弹出时刻固定，
// 换书关掉重弹；章可在窗内随时切。

export function RefWindowApp({ bookId, initialChapterId }: { bookId: number | null; initialChapterId: number | null }) {
  const [chapters, setChapters] = useState<ChapterMeta[]>([]);
  const [selected, setSelected] = useState<number | null>(initialChapterId);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 浮窗文档标题：CDP target 标题/任务栏预览都读它，与原生窗标题（参考 · 笔仙）保持一致
  useEffect(() => {
    document.title = "参考 · 笔仙";
  }, []);

  useEffect(() => {
    if (bookId == null) return;
    api
      .listChapters(bookId)
      .then(setChapters)
      .catch((e) => setError(String(e)));
  }, [bookId]);

  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    setContent(null);
    api
      .readChapter(selected)
      .then((full) => !cancelled && setContent(full.content))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const meta = chapters.find((c) => c.id === selected);

  return (
    <ThemeProvider>
      <div className="flex h-full flex-col bg-[var(--bg-panel)] p-3 text-xs" data-testid="ref-window">
        <div className="mb-2 flex shrink-0 items-center gap-1.5">
          <BookOpen size={12} className="shrink-0 text-[color:var(--accent)]" />
          <select
            value={selected ?? ""}
            onChange={(e) => setSelected(e.target.value === "" ? null : Number(e.target.value))}
            data-testid="ref-window-chapter-select"
            className="min-w-0 flex-1 rounded-md border border-[color:var(--border-subtle)] bg-transparent px-1.5 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
          >
            <option value="">选择要参考的章…</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        {error && <div className="mb-2 shrink-0 text-[color:var(--accent-hover)]">{error}</div>}
        {selected != null && meta && (
          <div className="mb-1 shrink-0 text-[10px] text-[color:var(--text-faint)]">
            {meta.title}
            {content != null && ` · ${countWords(content).toLocaleString()} 字`}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {selected == null ? (
            <div className="text-[color:var(--text-faint)]">从上方选一章在此只读展示。</div>
          ) : content == null ? (
            <div className="text-[color:var(--text-faint)]">载入中…</div>
          ) : content.trim() === "" ? (
            <div className="text-[color:var(--text-faint)]">这一章还是空的。</div>
          ) : (
            <div className="prose-serif whitespace-pre-wrap leading-relaxed text-[color:var(--text-secondary)]">
              {content}
            </div>
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}
