import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Eye, MessageSquare, RefreshCw, SendHorizontal, Square, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useChat } from "../../stores/chat";
import { api, AssemblyLog } from "../../lib/tauri";
import { ContextPreview } from "./ContextPreview";
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
  // 消息流 ↔ 上下文预览 双视图；预览用的 instruction 取自输入框文本
  const [view, setView] = useState<"chat" | "preview">("chat");
  const [log, setLog] = useState<AssemblyLog | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // 换章节重新初始化会话；卸载解除事件监听
  useEffect(() => {
    if (currentChapterId != null) void initForChapter(currentChapterId);
    // 章节变了，上一次的组装结果不再对应，回消息流并清空预览
    setView("chat");
    setLog(null);
    setPreviewError(null);
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

  // 预览：以当前输入框文本为写作指令，向后端要一份本次续写的组装日志
  const loadPreview = async () => {
    if (sessionId == null || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setLog(await api.previewContext(sessionId, input.trim()));
    } catch (e) {
      setPreviewError(String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const togglePreview = () => {
    if (view === "preview") {
      setView("chat");
      return;
    }
    setView("preview");
    void loadPreview();
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
          onClick={togglePreview}
          disabled={sessionId == null}
          title={view === "preview" ? "返回消息流" : "查看本次续写的上下文组装"}
          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors duration-150 hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40 ${
            view === "preview"
              ? "text-[color:var(--accent)]"
              : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
          }`}
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

      {view === "preview" ? (
        /* 预览视图：本次续写的槽位组装明细 */
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-end px-2 pt-2">
            <button
              onClick={() => void loadPreview()}
              disabled={previewLoading || sessionId == null}
              title="重新组装并刷新"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RefreshCw size={12} className={previewLoading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>
          {previewError != null && (
            <div className="mx-2.5 mt-2 break-all rounded-md border border-[color:var(--danger)] px-2.5 py-1.5 text-xs leading-relaxed text-[color:var(--danger)]">
              {previewError}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ContextPreview log={log} loading={previewLoading} />
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}
    </div>
  );
}
