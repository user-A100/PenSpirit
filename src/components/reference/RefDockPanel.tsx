import { useEffect, useState } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import { api, type ChapterMeta } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { countWords } from "../../lib/words";

// 参考窗（M7 批次5，Scrivener Copyholder 的 dock 版）：
// 只读查阅本书任意一章，写作时对照着看。可一键弹出为真正的 OS 浮窗（批次7）。
// 渲染用纯文本（markdown 记号保留原样），避免为只读场景再起一个 TipTap 实例。

export function RefDockPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const chapters = useWorkspace((s) => s.chapters);
  const [selected, setSelected] = useState<number | null>(null);
  const [content, setContent] = useState<string | null>(null);

  // 换书时回到未选中
  useEffect(() => {
    setSelected(null);
    setContent(null);
  }, [currentBookId]);

  useEffect(() => {
    if (selected == null) return;
    let cancelled = false;
    setContent(null);
    api
      .readChapter(selected)
      .then((full) => !cancelled && setContent(full.content))
      .catch((e) => !cancelled && console.warn(e));
    return () => {
      cancelled = true;
    };
  }, [selected]);

  if (currentBookId == null) {
    return <div className="flex h-full items-center justify-center p-4 text-xs text-[color:var(--text-faint)]">先选一本书</div>;
  }

  const meta: ChapterMeta | undefined = chapters.find((c) => c.id === selected);

  return (
    <div className="flex h-full flex-col p-3 text-xs" data-testid="ref-panel">
      <div className="mb-2 flex shrink-0 items-center gap-1.5">
        <BookOpen size={12} className="shrink-0 text-[color:var(--accent)]" />
        <select
          value={selected ?? ""}
          onChange={(e) => setSelected(e.target.value === "" ? null : Number(e.target.value))}
          data-testid="ref-chapter-select"
          className="min-w-0 flex-1 rounded-md border border-[color:var(--border-subtle)] bg-transparent px-1.5 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
        >
          <option value="">选择要参考的章…</option>
          {chapters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
        <button
          onClick={() => currentBookId != null && void api.openRefWindow(currentBookId, selected)}
          disabled={selected == null}
          title="弹出为独立浮窗（可拖到屏幕任意角落对照）"
          data-testid="ref-popout"
          className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-40"
        >
          <ExternalLink size={12} />
        </button>
      </div>
      {selected != null && meta && (
        <div className="mb-1 shrink-0 text-[10px] text-[color:var(--text-faint)]">
          {meta.title}
          {content != null && ` · ${countWords(content).toLocaleString()} 字`}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected == null ? (
          <div className="text-[color:var(--text-faint)]">选一章在此只读展示，写作时可随时对照。</div>
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
  );
}
