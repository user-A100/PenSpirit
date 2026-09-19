import { CornerDownLeft } from "lucide-react";
import type { ChatMessage } from "../../lib/tauri";
import { useChat } from "../../stores/chat";

// 消息气泡：user 右对齐 accent-dim 底，assistant 左对齐 bg-elevated 底。
// assistant hover 浮现操作行（采纳进正文 / 删除）；流式中的气泡末尾带闪烁光标。
export function MessageBubble({ message, streaming = false }: { message: ChatMessage; streaming?: boolean }) {
  const isUser = message.role === "user";
  const adopt = useChat((s) => s.adopt);
  const remove = useChat((s) => s.deleteMessage);

  return (
    <div className={`group flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
          isUser
            ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]"
            : "bg-[var(--bg-elevated)] text-[color:var(--text-secondary)]"
        }`}
      >
        {message.content}
        {!isUser && streaming && <span className="animate-pulse text-[color:var(--accent)]">▍</span>}
      </div>
      {!isUser && !streaming && (
        <div className="ml-1.5 flex items-center gap-1 self-end pb-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          <button
            onClick={() => void adopt(message.id)}
            title="把这段内容追加到当前章节正文"
            className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-[color:var(--accent)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
          >
            <CornerDownLeft size={12} />
            采纳进正文
          </button>
          <button
            onClick={() => void remove(message.id)}
            title="删除这条消息"
            className="rounded px-1 py-0.5 text-xs text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
          >
            删除
          </button>
        </div>
      )}
    </div>
  );
}
