import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, MessageSquare, SendHorizontal, Square, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useChat } from "../../stores/chat";
import { MessageBubble } from "./MessageBubble";

interface AiDockProps {
  // 折叠态由 EditorPane 持有（Panel collapsible + collapsedSize 36px），这里只负责渲染
  collapsed: boolean;
  onToggle: () => void;
}

export function AiDock({ collapsed, onToggle }: AiDockProps) {
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const sessionId = useChat((s) => s.sessionId);
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const streamText = useChat((s) => s.streamText);
  const error = useChat((s) => s.error);
  const initForChapter = useChat((s) => s.initForChapter);
  const send = useChat((s) => s.send);
  const stop = useChat((s) => s.stop);
  const clearError = useChat((s) => s.clearError);
  const dispose = useChat((s) => s.dispose);

  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // 换章节重新初始化会话；卸载解除事件监听
  useEffect(() => {
    if (currentChapterId != null) void initForChapter(currentChapterId);
    return () => dispose();
  }, [currentChapterId, initForChapter, dispose]);

  // 自动滚底：新消息或流式增量到达时贴底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [streamText, messages]);

  const doSend = async () => {
    const text = input.trim();
    if (!text || streaming || currentChapterId == null) return;
    setInput("");
    const ok = await send(text);
    if (!ok) setInput(text); // 发送失败还原输入，避免丢字
  };

  // 折叠成 36px 条：点击展开
  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        title="展开 AI 续写"
        className="flex h-9 w-full items-center gap-2 border-t border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-3 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        <ChevronUp size={14} className="shrink-0" />
        <MessageSquare size={14} className={`shrink-0 ${streaming ? "text-[color:var(--accent)]" : ""}`} />
        <span className="shrink-0">AI 续写</span>
        {streaming && <span className="truncate text-[color:var(--accent)]">生成中…</span>}
      </button>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)]">
      {/* 顶栏 36px */}
      <div className="flex h-9 shrink-0 items-center gap-1.5 border-b border-[color:var(--border-subtle)] pl-1.5 pr-2">
        <button
          onClick={onToggle}
          title="折叠"
          className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
        >
          <ChevronDown size={14} />
        </button>
        <MessageSquare size={14} className="shrink-0 text-[color:var(--accent)]" />
        <span className="shrink-0 text-xs font-medium text-[color:var(--text-primary)]">AI 续写</span>
        <div className="min-w-0 flex-1" />
        <button
          disabled
          title="T8 提供"
          className="flex cursor-not-allowed items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-faint)]"
        >
          <Eye size={12} />
          预览
        </button>
        {streaming && (
          <button
            onClick={() => void stop()}
            title="停止生成"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--danger)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
          >
            <Square size={11} />
            停止
          </button>
        )}
      </div>

      {/* 错误条 */}
      {error != null && (
        <div className="mx-2.5 mt-2 flex items-start gap-1.5 rounded-md border border-[color:var(--danger)] px-2.5 py-1.5">
          <span className="min-w-0 flex-1 break-all text-xs leading-relaxed text-[color:var(--danger)]">{error}</span>
          <button
            onClick={clearError}
            title="关闭"
            className="shrink-0 rounded p-0.5 text-[color:var(--danger)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* 消息列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !streaming && error == null && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MessageSquare size={28} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
            <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
              {currentChapterId == null ? "选择一个章节后开始 AI 续写" : "向 AI 描述这段要怎么写，Enter 发送"}
            </div>
          </div>
        )}
        <div className="space-y-2.5">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {streaming && (
            <MessageBubble
              streaming
              message={{ id: -1, session_id: sessionId ?? 0, role: "assistant", content: streamText, created_at: "" }}
            />
          )}
        </div>
        <div ref={bottomRef} />
      </div>

      {/* 输入区：Enter 发送，Shift+Enter 换行（IME 组合中回车不发送） */}
      <div className="shrink-0 border-t border-[color:var(--border-subtle)] p-2">
        <div className="flex items-end gap-1.5 rounded-md border border-transparent bg-[var(--bg-elevated)] px-2 py-1.5 transition-colors duration-150 focus-within:border-[color:var(--accent)]">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void doSend();
              }
            }}
            rows={2}
            placeholder={currentChapterId == null ? "选择章节后可用" : "写作指令，Enter 发送 / Shift+Enter 换行"}
            className="min-h-0 max-h-28 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
          <button
            onClick={() => void doSend()}
            disabled={streaming || !input.trim() || currentChapterId == null}
            title="发送"
            className="shrink-0 rounded-md bg-[var(--accent-dim)] p-1.5 text-[color:var(--accent)] transition-colors duration-150 hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizontal size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
