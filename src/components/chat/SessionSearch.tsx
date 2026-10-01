import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { api, type SessionHit } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { useChat } from "../../stores/chat";

// 搜索全书对话（阶段 2B）：标题或任一消息内容命中；点结果 = 切到那一章并打开那个会话。
export function SessionSearch({ onClose }: { onClose: () => void }) {
  const bookId = useWorkspace((s) => s.currentBookId);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SessionHit[]>([]);
  useEffect(() => {
    if (bookId == null || !q.trim()) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const h = window.setTimeout(() => {
      void api
        .sessionsSearch(bookId, q)
        .then((r) => !cancelled && setHits(r))
        .catch(() => !cancelled && setHits([]));
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [bookId, q]);
  const open = async (hit: SessionHit) => {
    const ws = useWorkspace.getState();
    onClose();
    if (ws.currentChapterId === hit.session.chapter_id) {
      await useChat.getState().openSession(hit.session.id);
    } else {
      useChat.setState({ openAfterInit: hit.session.id });
      await ws.selectChapter(hit.session.chapter_id);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 py-2" data-testid="session-search">
      <div className="flex items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--fill-element)] px-2">
        <Search size={13} className="shrink-0 text-[color:var(--text-faint)]" />
        <input
          autoFocus
          value={q}
          aria-label="搜索全书对话"
          placeholder="搜索全书对话：如「反派动机」"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          className="h-8 min-w-0 flex-1 bg-transparent text-ui text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
        />
        <button aria-label="关闭搜索" onClick={onClose} className="shrink-0 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
          <X size={13} />
        </button>
      </div>
      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {q.trim() && hits.length === 0 && <div className="px-1 text-xs text-[color:var(--text-faint)]">没有找到</div>}
        {hits.map((h) => (
          <button
            key={h.session.id}
            data-session-hit={h.session.id}
            onClick={() => void open(h)}
            className="block w-full rounded-[var(--r-control)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--fill-hover)]"
          >
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 truncate font-medium text-[color:var(--text-primary)]">{h.session.title}</span>
              <span className="shrink-0 text-2xs text-[color:var(--text-faint)]">《{h.chapter_title}》</span>
            </div>
            {h.snippet && <div className="mt-0.5 truncate text-2xs text-[color:var(--text-secondary)]">{h.snippet}</div>}
          </button>
        ))}
      </div>
    </div>
  );
}
