import { useEffect, useRef, useState } from "react";
import { Eraser, RotateCcw, Trash2, X } from "lucide-react";
import { trashApi, type TrashedChapter } from "../../lib/tauri_trash";
import { useWorkspace } from "../../stores/workspace";

// 回收站下拉面板（当前书）：软删章列表 + 恢复/彻底删除/清空。
// 由 Sidebar 书列表头部 Trash2 按钮唤起；父容器需 relative。
// 「彻底删除」「清空」均为二次点击确认态，防误触。

export function TrashPanel(props: { bookId: number | null; onClose: () => void }) {
  const reloadChapters = useWorkspace((s) => s.reloadChapters);
  const [items, setItems] = useState<TrashedChapter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirmPurgeId, setConfirmPurgeId] = useState<number | null>(null);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = async (bookId: number) => {
    try {
      setItems(await trashApi.listTrash(bookId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    setConfirmPurgeId(null);
    setConfirmEmpty(false);
    if (props.bookId != null) void load(props.bookId);
    else setItems([]);
  }, [props.bookId]);

  // 点击面板外关闭（唤起按钮自身带 data-trash-toggle，避免开→关→再开的抖动）
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (ref.current && !ref.current.contains(t) && !t.closest("[data-trash-toggle]")) props.onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [props.onClose]);

  const act = async (fn: () => Promise<void>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const restore = (id: number) =>
    act(async () => {
      await trashApi.restoreChapter(id);
      setConfirmPurgeId(null);
      setConfirmEmpty(false);
      await reloadChapters();
      if (props.bookId != null) await load(props.bookId);
    });

  const purge = (id: number) =>
    act(async () => {
      await trashApi.purgeChapter(id);
      setConfirmPurgeId(null);
      if (props.bookId != null) await load(props.bookId);
    });

  const empty = () =>
    act(async () => {
      if (props.bookId == null) return;
      await trashApi.emptyTrash(props.bookId);
      setConfirmEmpty(false);
      await load(props.bookId);
    });

  return (
    <div
      ref={ref}
      className="absolute left-2 top-full z-50 mt-1 w-72 rounded-lg border border-[color:var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl"
    >
      {/* 头部：标题 + 清空 + 关闭 */}
      <div className="flex items-center gap-1 border-b border-[color:var(--border-subtle)] px-3 py-2">
        <Trash2 size={13} className="text-[color:var(--text-faint)]" />
        <span className="flex-1 text-xs font-medium text-[color:var(--text-primary)]">
          回收站{items.length > 0 && <span className="ml-1 text-[color:var(--text-faint)]">({items.length})</span>}
        </span>
        {items.length > 0 &&
          (confirmEmpty ? (
            <button
              onClick={() => void empty()}
              title="确认清空"
              className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--danger)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
            >
              确认清空
            </button>
          ) : (
            <button
              onClick={() => {
                setConfirmEmpty(true);
                setConfirmPurgeId(null);
              }}
              title="清空回收站"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
            >
              <Eraser size={12} />
              清空
            </button>
          ))}
        <button
          onClick={props.onClose}
          title="关闭"
          className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--text-primary)]"
        >
          <X size={13} />
        </button>
      </div>

      {error && (
        <div className="px-3 py-2 text-[11px] text-[color:var(--danger)]">{error}</div>
      )}

      <div className="max-h-80 overflow-y-auto p-1.5">
        {props.bookId == null ? (
          <div className="px-3 py-4 text-center text-xs text-[color:var(--text-faint)]">请先选择书籍</div>
        ) : items.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-[color:var(--text-faint)]">回收站是空的</div>
        ) : (
          items.map((c) => (
            <div
              key={c.id}
              className="mb-1 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
            >
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-primary)]" title={c.title}>
                  {c.title}
                </span>
                <button
                  onClick={() => void restore(c.id)}
                  title="恢复"
                  className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--accent-hover)]"
                >
                  <RotateCcw size={12} />
                </button>
                {confirmPurgeId === c.id ? (
                  <button
                    onClick={() => void purge(c.id)}
                    title="确认彻底删除"
                    className="shrink-0 rounded bg-[color:var(--danger)]/15 px-1.5 py-0.5 text-[11px] text-[color:var(--danger)] transition-colors duration-150 hover:bg-[color:var(--danger)]/25"
                  >
                    确认
                  </button>
                ) : (
                  <button
                    onClick={() => setConfirmPurgeId(c.id)}
                    title="彻底删除"
                    className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[color:var(--text-faint)]" title={c.orig_file_path ?? ""}>
                {c.orig_file_path} · 删除于 {c.deleted_at}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
