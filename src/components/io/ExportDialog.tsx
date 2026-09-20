import { useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { FileDown } from "lucide-react";
import { api, type ChapterMeta } from "../../lib/tauri";
import { Modal } from "../ui/Modal";

// M2-T8 导出对话框：勾选章节 → 选格式 → 选保存路径。
// 默认全选（导出整本是最常见诉求）；输出顺序由 Rust 侧按书内章节序决定，
// 与勾选顺序无关。卷不落库，故这里是平铺章节列表。

export function ExportDialog(props: {
  bookId: number;
  bookTitle: string;
  chapters: ChapterMeta[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<number>>(new Set(props.chapters.map((c) => c.id)));
  const [format, setFormat] = useState<"txt" | "docx">("txt");
  const [indent, setIndent] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const run = async () => {
    if (picked.size === 0) return;
    try {
      const dest = await save({
        defaultPath: `${props.bookTitle}.${format}`,
        filters: [
          format === "txt"
            ? { name: "文本文件", extensions: ["txt"] }
            : { name: "Word 文档", extensions: ["docx"] },
        ],
      });
      if (dest == null) return;
      setBusy(true);
      const ids = [...picked];
      if (format === "docx") await api.exportDocx(props.bookId, ids, dest);
      else await api.exportTxt(props.bookId, ids, indent, dest);
      setDone(`已导出到 ${dest}`);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalWords = props.chapters.reduce((n, c) => (picked.has(c.id) ? n + c.word_count : n), 0);
  const allPicked = picked.size === props.chapters.length && props.chapters.length > 0;

  return (
    <Modal
      open
      onClose={props.onClose}
      title="导出"
      widthClass="max-w-lg"
      testId="export-backdrop"
    >
        {/* 格式与选项 */}
        <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-[color:var(--border-subtle)] px-4 py-3">
          <div className="flex items-center gap-1">
            {(["txt", "docx"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFormat(f)}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors duration-150 ${
                  format === f
                    ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {f.toUpperCase()}
              </button>
            ))}
          </div>
          {format === "txt" && (
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
              <input
                type="checkbox"
                checked={indent}
                onChange={(e) => setIndent(e.target.checked)}
                className="accent-[color:var(--accent)]"
              />
              段首缩进
            </label>
          )}
        </div>

        {error && <div className="px-4 py-2 text-xs text-[color:var(--danger)]">{error}</div>}
        {done && <div className="break-all px-4 py-2 text-xs text-[color:var(--success)]">{done}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {props.chapters.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[color:var(--text-faint)]">
              这本书还没有章节
            </div>
          ) : (
            props.chapters.map((c) => (
              <label
                key={c.id}
                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
              >
                <input
                  type="checkbox"
                  checked={picked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="shrink-0 accent-[color:var(--accent)]"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-primary)]">
                  {c.title}
                </span>
                <span className="shrink-0 text-[11px] text-[color:var(--text-faint)]">
                  {c.word_count.toLocaleString()} 字
                </span>
              </label>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--border-subtle)] px-4 py-3">
          <button
            onClick={() =>
              setPicked(allPicked ? new Set() : new Set(props.chapters.map((c) => c.id)))
            }
            disabled={props.chapters.length === 0}
            className="text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            {allPicked ? "全不选" : "全选"}
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[color:var(--text-faint)]">
              {totalWords > 0 && `约 ${totalWords.toLocaleString()} 字`}
            </span>
            <button
              onClick={() => void run()}
              disabled={busy || picked.size === 0}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-40"
            >
              <FileDown size={13} />
              {busy ? "导出中…" : "导出"}
            </button>
          </div>
        </div>
    </Modal>
  );
}
