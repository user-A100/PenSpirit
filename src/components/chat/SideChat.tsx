import { useEffect, useRef, useState } from "react";
import { Eraser, Square, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { getActiveEditor } from "../../lib/editorBridge";
import { runTransient, type TransientRun } from "../../lib/ai/transient";
import { errMsg } from "../../lib/errors";
import { Markdown } from "./Markdown";

// 侧聊（阶段 2C）：AI 卡里并排的第二个对话——随手问一句（「这个反派动机够吗？」），
// 带当前章与设定上下文，但不进正式对话、不落库，也不污染正式对话的历史。关掉即清空。
interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function SideChat({ onClose }: { onClose: () => void }) {
  const chapterId = useWorkspace((s) => s.currentChapterId);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<string | null>(null);
  const runRef = useRef<TransientRun | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => runRef.current?.cancel(), []);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, stream]);

  const send = () => {
    const q = input.trim();
    if (!q || chapterId == null || stream != null) return;
    const ed = getActiveEditor();
    const ctx = ed && ed.chapterId === chapterId ? ed.getContext() : null;
    const history = turns.slice(-8);
    setInput("");
    setTurns((t) => [...t, { role: "user", content: q }]);
    setStream("");
    const run = runTransient({ kind: "discuss", chapter_id: chapterId, instruction: q, before: ctx?.before ?? "", after: ctx?.after ?? "", history }, (all) => setStream(all));
    runRef.current = run;
    run.done
      .then((full) => setTurns((t) => [...t, { role: "assistant", content: full }]))
      .catch((e) => setTurns((t) => [...t, { role: "assistant", content: `（出错了：${errMsg(e)}）` }]))
      .finally(() => {
        if (runRef.current === run) runRef.current = null;
        setStream(null);
      });
  };

  return (
    <div data-testid="side-chat" className="flex min-h-0 w-[42%] min-w-[240px] max-w-[440px] shrink-0 flex-col border-l border-[color:var(--hairline)]">
      <div className="flex h-8 shrink-0 items-center gap-1 px-2 text-xs">
        <span className="font-medium text-[color:var(--text-primary)]">侧聊</span>
        <span className="min-w-0 flex-1 truncate text-2xs text-[color:var(--text-faint)]">随手问，不进正式对话、不落库</span>
        <button aria-label="清空侧聊" data-tip="清空" disabled={turns.length === 0 || stream != null} onClick={() => setTurns([])} className="rounded p-1 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)] disabled:opacity-30">
          <Eraser size={12} />
        </button>
        <button aria-label="关闭侧聊" onClick={onClose} className="rounded p-1 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
          <X size={12} />
        </button>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-2 py-1 text-sm">
        {turns.length === 0 && stream == null && <div className="px-1 pt-2 text-2xs text-[color:var(--text-faint)]">比如：「这个反派的动机站得住吗？」「这一章节奏是不是太慢？」</div>}
        {turns.map((t, i) =>
          t.role === "user" ? (
            <div key={i} data-side-turn="user" className="ml-6 whitespace-pre-wrap break-words rounded-[10px] bg-[var(--fill-element)] px-2.5 py-1.5 text-xs text-[color:var(--text-primary)]">
              {t.content}
            </div>
          ) : (
            <div key={i} data-side-turn="assistant" className="text-xs leading-relaxed text-[color:var(--text-primary)]">
              <Markdown text={t.content} />
            </div>
          ),
        )}
        {stream != null && (
          <div data-side-turn="streaming" className="text-xs leading-relaxed text-[color:var(--text-primary)]">
            <Markdown text={stream || "…"} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-end gap-1 p-2">
        <textarea
          value={input}
          aria-label="侧聊输入"
          rows={2}
          placeholder="问一句…（Enter 发送）"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="min-h-0 flex-1 resize-none rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--fill-element)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
        />
        {stream != null && (
          <button aria-label="停止侧聊" onClick={() => runRef.current?.cancel()} className="rounded-[var(--r-control)] p-1.5 text-[color:var(--danger)] hover:bg-[var(--fill-hover)]">
            <Square size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
