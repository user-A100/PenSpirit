import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useChat } from "../../stores/chat";

// 会话内查找（阶段 2C）：Ctrl+F（焦点在 AI 卡里时）或顶栏按钮打开；回车下一个、Shift+回车上一个、Esc 关闭。
// 用 CSS 自定义高亮（::highlight）标出命中，不改动消息的 DOM。

export const useChatFind = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));

/** 在容器的文本节点里找出全部命中（不区分大小写） */
export function findRanges(root: Element, query: string): Range[] {
  const needle = query.toLowerCase();
  const out: Range[] = [];
  if (!needle) return out;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const text = n.data.toLowerCase();
    let i = text.indexOf(needle);
    while (i >= 0) {
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + needle.length);
      out.push(r);
      i = text.indexOf(needle, i + needle.length);
    }
  }
  return out;
}

type HighlightCtor = new (...ranges: Range[]) => unknown;
function registry(): { set: (k: string, v: unknown) => void; delete: (k: string) => void } | null {
  const reg = (globalThis.CSS as unknown as { highlights?: { set: (k: string, v: unknown) => void; delete: (k: string) => void } } | undefined)?.highlights;
  return reg && (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight ? reg : null;
}

function paint(ranges: Range[], current: number) {
  const reg = registry();
  if (!reg) return;
  const H = (globalThis as unknown as { Highlight: HighlightCtor }).Highlight;
  reg.set("chat-find", new H(...ranges));
  reg.set("chat-find-current", ranges[current] ? new H(ranges[current]) : new H());
}

function clearPaint() {
  const reg = registry();
  reg?.delete("chat-find");
  reg?.delete("chat-find-current");
}

export function ChatFind() {
  const open = useChatFind((s) => s.open);
  const setOpen = useChatFind((s) => s.setOpen);
  const messages = useChat((s) => s.messages);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) {
      clearPaint();
      return;
    }
    const root = document.querySelector("[data-message-list]");
    const ranges = root && q.trim() ? findRanges(root, q.trim()) : [];
    setCount(ranges.length);
    const cur = ranges.length ? ((idx % ranges.length) + ranges.length) % ranges.length : 0;
    paint(ranges, cur);
    const el = ranges[cur]?.startContainer.parentElement;
    el?.scrollIntoView?.({ block: "center" });
    el?.closest("[data-msg]")?.setAttribute("data-find-current", "");
    return () => {
      document.querySelectorAll("[data-find-current]").forEach((x) => x.removeAttribute("data-find-current"));
    };
  }, [open, q, idx, messages]);

  useEffect(() => clearPaint, []);

  if (!open) return null;
  const cur = count ? ((idx % count) + count) % count : 0;
  return (
    <div className="mx-3 mb-1 flex items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--fill-element)] px-2" data-testid="chat-find" data-find-count={count}>
      <input
        ref={inputRef}
        value={q}
        aria-label="在对话中查找"
        placeholder="在本对话中查找"
        onChange={(e) => {
          setQ(e.target.value);
          setIdx(0);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "Enter") {
            e.preventDefault();
            setIdx((i) => i + (e.shiftKey ? -1 : 1));
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
        }}
        className="h-7 min-w-0 flex-1 bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
      />
      <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-faint)]">{q.trim() ? (count ? `${cur + 1}/${count}` : "无结果") : ""}</span>
      <button aria-label="上一个" disabled={!count} onClick={() => setIdx((i) => i - 1)} className="rounded p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)] disabled:opacity-30">
        <ChevronUp size={13} />
      </button>
      <button aria-label="下一个" disabled={!count} onClick={() => setIdx((i) => i + 1)} className="rounded p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)] disabled:opacity-30">
        <ChevronDown size={13} />
      </button>
      <button aria-label="关闭查找" onClick={() => setOpen(false)} className="rounded p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
        <X size={13} />
      </button>
    </div>
  );
}
