import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  CornerDownLeft,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Replace,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ChatMessage } from "../../lib/tauri";
import { isTruncated, messageCommand, messageMode, useChat, type QuoteRef } from "../../stores/chat";
import { adoptReply, type AdoptHow } from "../../lib/ai/adopt";
import { findCommand } from "../../lib/ai/slashCommands";
import { plainText } from "../../lib/ai/cleanText";
import { openMenuAt } from "../../stores/menu";
import { confirmDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";

// 消息流（阶段 2A）：按「一问 + 若干版本的答」成组；版本切换 ‹k/n›；
// 采纳三式（插入光标 / 替换选区 / 追加章末，按命令给主按钮）；复制 / 重新生成 / 编辑重发；
// 上翻锁定滚动 +「跳到最新」。

interface Turn {
  key: string;
  user: ChatMessage | null;
  replies: ChatMessage[];
}

function buildTurns(messages: ChatMessage[]): Turn[] {
  const turns: Turn[] = [];
  const byUser = new Map<number, Turn>();
  for (const m of messages) {
    if (m.role === "user") {
      const t: Turn = { key: `u${m.id}`, user: m, replies: [] };
      turns.push(t);
      byUser.set(m.id, t);
    } else if (m.reply_to != null && byUser.has(m.reply_to)) {
      byUser.get(m.reply_to)!.replies.push(m);
    } else {
      turns.push({ key: `a${m.id}`, user: null, replies: [m] });
    }
  }
  return turns;
}

function ProseText({ text, caret }: { text: string; caret?: boolean }) {
  const paras = text.replace(/\r\n/g, "\n").split("\n").filter((l) => l.trim() !== "");
  return (
    <div className="ai-prose">
      {paras.length === 0 && caret && <p>&nbsp;</p>}
      {paras.map((p, i) => (
        <p key={i}>
          {p.trim()}
          {caret && i === paras.length - 1 && <span className="ai-caret">▍</span>}
        </p>
      ))}
    </div>
  );
}

function ReplyBody({ text, mode, streaming }: { text: string; mode: "write" | "discuss"; streaming?: boolean }) {
  if (mode === "discuss") {
    return (
      <div>
        <Markdown text={text} />
        {streaming && <span className="ai-caret">▍</span>}
      </div>
    );
  }
  return <ProseText text={text} caret={streaming} />;
}

const ACT =
  "flex items-center gap-1 rounded-[4px] px-1.5 py-1 text-2xs text-[color:var(--text-faint)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40";

function TurnView({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  const streaming = useChat((s) => s.streaming);
  const streamText = useChat((s) => s.streamText);
  const streamReplyTo = useChat((s) => s.streamReplyTo);
  const quote: QuoteRef | null = useChat((s) => (turn.user ? s.quoteByMessage[turn.user.id] ?? null : null));
  const cmdId = useChat((s) => (turn.user ? s.commandByMessage[turn.user.id] ?? null : null));
  const { regenerate, switchVariant, deleteMessage, editResend, send } = useChat.getState();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const shown = turn.replies.find((r) => r.active !== false) ?? turn.replies[turn.replies.length - 1] ?? null;
  const idx = shown ? turn.replies.indexOf(shown) : -1;
  // 流式中的回答落在本组：新一轮（用户消息是乐观临时 id 或已落库 id）或对本组重新生成
  const streamingHere =
    streaming && ((turn.user && streamReplyTo === turn.user.id) || (streamReplyTo == null && isLast && turn.user != null && turn.replies.length === 0));
  const mode = shown ? messageMode(shown) : useChat.getState().mode;
  const command = findCommand(cmdId ?? (shown ? messageCommand(shown) : null));
  const output = command?.output ?? (mode === "write" ? "insert" : "chat");

  const adopt = (how: AdoptHow) => shown && void adoptReply(shown, how, quote);
  const adoptMenu = (el: Element) =>
    openMenuAt(el, [
      { label: "插入光标处", icon: CornerDownLeft, onSelect: () => adopt("insert") },
      { label: "替换选区（先看差异）", icon: Replace, onSelect: () => adopt("replace") },
      { label: "追加到章末", icon: ArrowDown, onSelect: () => adopt("append") },
    ]);

  const later = useChat.getState().messages.filter((m) => turn.user && m.id > turn.user.id).length;

  return (
    <div className="flex flex-col gap-2">
      {turn.user && (
        <div className="group/user flex flex-col items-end gap-1">
          {(command || quote) && (
            <div className="flex max-w-[85%] items-center gap-1 text-2xs text-[color:var(--text-faint)]">
              {command && <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-1.5 py-px text-[color:var(--accent)]">/{command.name}</span>}
              {quote && <span className="truncate">选区「{quote.text.slice(0, 18)}{quote.text.length > 18 ? "…" : ""}」</span>}
            </div>
          )}
          {editing ? (
            <div className="flex w-full max-w-[85%] flex-col gap-1.5">
              <textarea
                autoFocus
                value={draft}
                aria-label="编辑问题"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (later > 1 && !(await confirmDialog({ title: "重新发送这个问题？", message: `其后的 ${later} 条对话会被移除（当前回答的各个版本也会一并移除）。`, confirmLabel: "重新发送" }))) return;
                    setEditing(false);
                    await editResend(turn.user!.id, draft);
                  }
                }}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                className="w-full resize-none rounded-[10px] border border-[color:var(--accent)] bg-[var(--bg-panel)] px-3 py-2 text-sm leading-relaxed text-[color:var(--text-primary)] outline-none"
              />
              <div className="flex justify-end gap-1 text-2xs text-[color:var(--text-faint)]">
                <span className="mr-auto">Enter 重新发送 · Esc 取消</span>
              </div>
            </div>
          ) : (
            <div className="flex max-w-[85%] items-end gap-1">
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--dur-md)] group-hover/user:opacity-100 focus-within:opacity-100">
                <button
                  aria-label="编辑并重新发送"
                  data-tip="编辑并重新发送"
                  disabled={streaming || turn.user.id < 0}
                  onClick={() => {
                    setDraft(turn.user!.content);
                    setEditing(true);
                  }}
                  className={ACT}
                >
                  <Pencil size={12} />
                </button>
                <button
                  aria-label="复制问题"
                  data-tip="复制"
                  onClick={() => {
                    void navigator.clipboard?.writeText(turn.user!.content);
                    toast.success("已复制");
                  }}
                  className={ACT}
                >
                  <Copy size={12} />
                </button>
                <button
                  aria-label="删除这一问"
                  data-tip="删除这一问（连同回答）"
                  disabled={streaming || turn.user.id < 0}
                  onClick={async () => {
                    if (turn.replies.length > 0 && !(await confirmDialog({ title: "删除这个问题？", message: "它的全部回答版本会一并删除。", confirmLabel: "删除", danger: true }))) return;
                    await deleteMessage(turn.user!.id);
                  }}
                  className={ACT}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="whitespace-pre-wrap break-words rounded-[12px] rounded-br-[4px] bg-[var(--fill-element)] px-3 py-2 text-sm leading-relaxed text-[color:var(--text-primary)]">
                {turn.user.content}
              </div>
            </div>
          )}
        </div>
      )}

      {(shown || streamingHere) && (
        <div className="group/ai flex flex-col gap-1.5" data-reply={shown?.id}>
          {streamingHere ? (
            <ReplyBody text={streamText} mode={mode} streaming />
          ) : (
            shown && (
              <>
                {(isTruncated(shown) || shown.adopted) && (
                  <div className="flex items-center gap-2 text-2xs">
                    {isTruncated(shown) && (
                      <span className="flex items-center gap-1 text-[color:var(--warning)]">
                        <TriangleAlert size={11} />
                        生成中断，已保留前半
                      </span>
                    )}
                    {shown.adopted && (
                      <span className="flex items-center gap-1 text-[color:var(--success)]">
                        <Check size={11} />
                        已采纳
                      </span>
                    )}
                  </div>
                )}
                <ReplyBody text={shown.content} mode={mode} />
                <div
                  className={`flex flex-wrap items-center gap-0.5 transition-opacity duration-[var(--dur-md)] ${
                    isLast ? "opacity-100" : "opacity-0 group-hover/ai:opacity-100 focus-within:opacity-100"
                  }`}
                >
                  {output !== "chat" ? (
                    <span className="mr-1 flex items-stretch overflow-hidden rounded-[var(--r-control)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-2xs font-medium text-[color:var(--accent)]">
                      <button onClick={() => adopt(output === "replace" ? "replace" : "insert")} className="flex items-center gap-1 px-2 py-1 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                        {output === "replace" ? <Replace size={12} /> : <CornerDownLeft size={12} />}
                        {output === "replace" ? "替换选区" : "插入光标处"}
                      </button>
                      <button aria-label="更多采纳方式" onClick={(e) => adoptMenu(e.currentTarget)} className="border-l border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)] px-1 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                        <ChevronDown size={12} />
                      </button>
                    </span>
                  ) : (
                    <button onClick={(e) => adoptMenu(e.currentTarget)} className={ACT} aria-label="采纳进正文">
                      <CornerDownLeft size={12} />
                      采纳…
                    </button>
                  )}
                  <button
                    aria-label="复制回答"
                    data-tip="复制（去掉 Markdown 记号）"
                    onClick={() => {
                      void navigator.clipboard?.writeText(plainText(shown.content));
                      toast.success("已复制");
                    }}
                    className={ACT}
                  >
                    <Copy size={12} />
                  </button>
                  {turn.user && (
                    <button aria-label="重新生成" data-tip="重新生成（保留当前版本）" disabled={streaming} onClick={() => void regenerate(turn.user!.id)} className={ACT}>
                      <RefreshCw size={12} />
                    </button>
                  )}
                  {turn.replies.length > 1 && (
                    <span className="flex items-center text-2xs tabular-nums text-[color:var(--text-faint)]" aria-label="回答版本">
                      <button aria-label="上一个版本" disabled={idx <= 0 || streaming} onClick={() => void switchVariant(turn.replies[idx - 1].id)} className={ACT}>
                        <ChevronLeft size={12} />
                      </button>
                      <span data-variant-index="">
                        {idx + 1}/{turn.replies.length}
                      </span>
                      <button aria-label="下一个版本" disabled={idx >= turn.replies.length - 1 || streaming} onClick={() => void switchVariant(turn.replies[idx + 1].id)} className={ACT}>
                        <ChevronRight size={12} />
                      </button>
                    </span>
                  )}
                  {isTruncated(shown) && turn.user && (
                    <button onClick={() => void send("接着你上一条回答继续写，不要重复已写内容。", { command: "continue-reply", mode: "write" })} disabled={streaming} className={ACT}>
                      继续写
                    </button>
                  )}
                  <button
                    aria-label="更多"
                    onClick={(e) =>
                      openMenuAt(e.currentTarget, [
                        { label: "删除这个版本", icon: Trash2, danger: true, onSelect: () => void deleteMessage(shown.id) },
                      ])
                    }
                    className={ACT}
                  >
                    <MoreHorizontal size={12} />
                  </button>
                  <span className="ml-auto text-2xs tabular-nums text-[color:var(--text-faint)]">{shown.content.replace(/\s/g, "").length} 字</span>
                </div>
              </>
            )
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ empty }: { empty: React.ReactNode }) {
  const messages = useChat((s) => s.messages);
  const streaming = useChat((s) => s.streaming);
  const streamText = useChat((s) => s.streamText);
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const atBottomRef = useRef(true);

  // 只在贴底时跟随新内容；用户上翻阅读时不打扰，给「跳到最新」
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streamText, streaming]);

  useEffect(() => {
    atBottomRef.current = atBottom;
  }, [atBottom]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          if (near !== atBottomRef.current) {
            atBottomRef.current = near;
            setAtBottom(near);
          }
        }}
        className="h-full overflow-y-auto px-4 py-3"
      >
        <PermissionCard />
        {turns.length === 0 && !streaming ? (
          empty
        ) : (
          <div className="flex flex-col gap-5">
            {turns.map((t, i) => (
              <TurnView key={t.key} turn={t} isLast={i === turns.length - 1} />
            ))}
          </div>
        )}
      </div>
      {!atBottom && (
        <button
          onClick={() => {
            const el = scrollRef.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
            atBottomRef.current = true;
            setAtBottom(true);
          }}
          className="toast-in absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-2xs text-[color:var(--text-secondary)] [box-shadow:var(--shadow-overlay)] hover:text-[color:var(--text-primary)]"
        >
          <ArrowDown size={11} />
          {streaming ? "正在生成 · 跳到最新" : "跳到最新"}
        </button>
      )}
    </div>
  );
}
