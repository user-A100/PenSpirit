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
  Star,
  GitBranch,
  Wand2,
  NotebookPen,
  History,
} from "lucide-react";
import { api, type ChatMessage } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { isTruncated, messageAgent, messageCandidates, messageCommand, messageMode, messageRetry, useChat, type QuoteRef } from "../../stores/chat";
import { AgentChanges, AgentTools } from "./AgentTools";
import { adoptReply, type AdoptHow } from "../../lib/ai/adopt";
import { findCommand } from "../../lib/ai/slashCommands";
import { plainText } from "../../lib/ai/cleanText";
import { parseDirections } from "../../lib/ai/directions";
import { estimateTokens } from "../../lib/ai/tokens";
import { EXTRACT_LABEL, runExtraction, type ExtractItem, type ExtractKind } from "../../lib/ai/extract";
import { errMsg } from "../../lib/errors";
import { ExtractDialog } from "./ExtractDialog";
import { checkpointFor, restoreCheckpoint } from "../../lib/ai/checkpoint";
import { openMenuAt } from "../../stores/menu";
import { confirmDialog, promptDialog } from "../../stores/confirm";
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

/** 重试选项（阶段 2B）：追加在原指令后的一次性要求 */
const RETRY_OPTIONS: Array<{ label: string; hint: string }> = [
  { label: "更长", hint: "这次写得更长、更细致，约为上一版的 1.5 倍" },
  { label: "更短", hint: "这次写得更短、更紧凑，约为上一版的一半" },
  { label: "换个写法", hint: "换一种明显不同的写法与切入角度，不要沿用上一版的句子" },
  { label: "更细腻", hint: "加强动作、神态与心理的细节描写" },
  { label: "更直白", hint: "写得更直白利落，少用修辞" },
];

function TurnView({ turn, isLast }: { turn: Turn; isLast: boolean }) {
  const streaming = useChat((s) => s.streaming);
  const streamTools = useChat((s) => s.streamTools);
  const streamText = useChat((s) => s.streamText);
  const streamReplyTo = useChat((s) => s.streamReplyTo);
  const quote: QuoteRef | null = useChat((s) => (turn.user ? s.quoteByMessage[turn.user.id] ?? null : null));
  const cmdId = useChat((s) => (turn.user ? s.commandByMessage[turn.user.id] ?? null : null));
  const { regenerate, switchVariant, deleteMessage, editResend, send, forkSession, starMessage } = useChat.getState();
  const pending = useChat((s) => s.pendingCandidates);
  const [extracting, setExtracting] = useState<{ kind: ExtractKind; items: ExtractItem[] } | null>(null);
  // 存为本章梗概（Binder / 软木板 / 大纲表都读这个字段）；已有梗概先确认再替换
  const saveAsSynopsis = async (m: ChatMessage) => {
    const chapterId = useChat.getState().chapterId;
    if (chapterId == null) return;
    const ws = useWorkspace.getState();
    const old = [...ws.chapters, ...ws.volumes].find((c) => c.id === chapterId)?.synopsis ?? "";
    if (old.trim() && !(await confirmDialog({ title: "替换本章梗概？", message: `现有梗概：${old.slice(0, 80)}${old.length > 80 ? "…" : ""}`, confirmLabel: "替换" }))) return;
    try {
      const meta = await api.chapterUpdateMeta(chapterId, { synopsis: plainText(m.content).trim() });
      useWorkspace.getState().patchNodes([meta]);
      toast.success("已存为本章梗概");
    } catch (e) {
      toast.error(`保存失败：${errMsg(e)}`);
    }
  };
  const startExtract = async (kind: ExtractKind) => {
    if (!shown) return;
    const t = toast.info(`正在从回答里抽取${EXTRACT_LABEL[kind]}…`);
    try {
      const items = await runExtraction(kind, shown);
      setExtracting({ kind, items });
    } catch (e) {
      toast.error(`抽取失败：${errMsg(e)}`);
    } finally {
      toast.dismiss(t);
    }
  };
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
  // 阶段 2B：多候选并排（本组任一版本标了 candidates≥2，或候选还在生成中）
  const candidatesPending = pending != null && turn.user != null && pending.userMessageId === turn.user.id;
  const candidateMode = turn.replies.some((r) => messageCandidates(r) >= 2) || (candidatesPending && turn.replies.length > 0);
  // 阶段 2B：「走向」回答拆成可点的几条
  const directions = !streamingHere && shown && command?.id === "directions" ? parseDirections(shown.content) : [];
  const retryMenu = (el: Element) =>
    openMenuAt(el, [
      ...RETRY_OPTIONS.map((o) => ({ label: o.label, onSelect: () => void regenerate(turn.user!.id, { retryHint: o.hint }) })),
      { type: "separator" as const },
      {
        label: "按我的要求重写…",
        onSelect: async () => {
          const hint = await promptDialog({ title: "这次要怎么改？", placeholder: "如：加一段雪景、对白更少一些", confirmLabel: "重新生成" });
          if (hint) void regenerate(turn.user!.id, { retryHint: hint });
        },
      },
    ]);

  // 只采纳选中部分（阶段 2B）：在这条回答里划选一段，采纳按钮就只用选中的文字
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState("");
  useEffect(() => {
    const onSel = () => {
      const el = bodyRef.current;
      const sel = document.getSelection();
      const inside = !!el && !!sel && !sel.isCollapsed && !!sel.anchorNode && !!sel.focusNode && el.contains(sel.anchorNode) && el.contains(sel.focusNode);
      setPicked(inside ? sel!.toString().trim() : "");
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);
  const adopt = (how: AdoptHow, part = picked) => shown && void adoptReply(shown, how, quote, part || undefined);
  const adoptMenu = (el: Element) => {
    const part = picked;
    openMenuAt(el, [
      { label: "插入光标处", icon: CornerDownLeft, onSelect: () => adopt("insert", part) },
      { label: "替换选区（先看差异）", icon: Replace, onSelect: () => adopt("replace", part) },
      { label: "追加到章末", icon: ArrowDown, onSelect: () => adopt("append", part) },
    ]);
  };
  const restore = async (m: ChatMessage) => {
    const ok = await confirmDialog({
      title: "恢复到采纳之前？",
      message: "本章会回到采纳这条回答之前的样子，之后的改动一并撤回。当前版本会先存进版本历史，也可以 Ctrl+Z 撤回这次恢复。",
      confirmLabel: "恢复",
    });
    if (!ok || !(await restoreCheckpoint(m.id))) return;
    void useChat.getState().markAdopted(m.id, false);
    toast.success("已恢复到采纳之前（当前版本已存进历史）");
  };

  const later = useChat.getState().messages.filter((m) => turn.user && m.id > turn.user.id).length;
  const agent = shown ? messageAgent(shown) : null;

  return (
    <div className="flex flex-col gap-2">
      {extracting && <ExtractDialog kind={extracting.kind} items={extracting.items} onClose={() => setExtracting(null)} />}
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
                  aria-label="从这一问分叉"
                  data-tip="从这一问分叉为新对话（之后的不带）"
                  disabled={streaming || turn.user.id < 0}
                  onClick={() => void forkSession(turn.user!.id)}
                  className={ACT}
                >
                  <GitBranch size={12} />
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

      {candidateMode && (
        <div
          data-candidates={turn.replies.length}
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${Math.min(3, turn.replies.length + (streamingHere ? 1 : 0))}, minmax(0, 1fr))` }}
        >
          {turn.replies.map((r, i) => {
            const on = r.active !== false;
            return (
              <div
                key={r.id}
                data-candidate={i + 1}
                className={`flex min-w-0 flex-col gap-1 rounded-[10px] border p-2 ${on ? "border-[color:var(--accent)]" : "border-[color:var(--hairline)]"}`}
              >
                <div className="flex items-center gap-1 text-2xs text-[color:var(--text-faint)]">
                  <span className={on ? "font-medium text-[color:var(--accent)]" : ""}>候选 {i + 1}</span>
                  {messageRetry(r) && <span className="truncate">· {messageRetry(r)}</span>}
                  <span className="ml-auto shrink-0 tabular-nums">{r.content.replace(/\s/g, "").length} 字</span>
                </div>
                <div className="max-h-64 overflow-y-auto text-sm">
                  <ReplyBody text={r.content} mode={messageMode(r)} />
                </div>
                <div className="flex items-center gap-0.5">
                  {on ? (
                    <span className="flex items-center gap-1 px-1.5 text-2xs text-[color:var(--accent)]">
                      <Check size={11} />
                      当前版
                    </span>
                  ) : (
                    <button onClick={() => void switchVariant(r.id)} disabled={streaming} className={ACT}>
                      用这版
                    </button>
                  )}
                  {output !== "chat" && (
                    <button onClick={() => void adoptReply(r, output === "replace" ? "replace" : "insert", quote)} className={ACT}>
                      {output === "replace" ? <Replace size={12} /> : <CornerDownLeft size={12} />}
                      {output === "replace" ? "替换选区" : "插入"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {streamingHere && (
            <div data-candidate="streaming" className="flex min-w-0 flex-col gap-1 rounded-[10px] border border-dashed border-[color:var(--hairline)] p-2">
              <div className="text-2xs text-[color:var(--text-faint)]">候选 {turn.replies.length + 1} 生成中…</div>
              <div className="max-h-64 overflow-y-auto text-sm">
                <ReplyBody text={streamText} mode={mode} streaming />
              </div>
            </div>
          )}
        </div>
      )}

      {(shown || streamingHere) && !(candidateMode && streamingHere) && (
        <div className="group/ai flex flex-col gap-1.5" data-reply={shown?.id}>
          {streamingHere ? (
            <>
              <AgentTools tools={streamTools} live />
              <ReplyBody text={streamText} mode={mode} streaming />
            </>
          ) : (
            shown && (
              <>
                {agent && <AgentTools tools={agent.tools} />}
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
                    {shown.adopted && checkpointFor(shown.id) && (
                      <button data-restore-checkpoint="" onClick={() => void restore(shown)} className="text-[color:var(--text-faint)] underline-offset-2 hover:text-[color:var(--text-primary)] hover:underline">
                        恢复到采纳之前
                      </button>
                    )}
                  </div>
                )}
                {command?.id === "compact" && (
                  <div className="flex items-center gap-1 text-2xs text-[color:var(--accent)]" data-compact-summary>
                    <Check size={11} />
                    会话摘要 · 之后的对话只带这份摘要，不再发送此前的内容
                  </div>
                )}
                {candidateMode ? null : directions.length >= 2 ? (
                  <div className="flex flex-col gap-1.5" data-directions={directions.length}>
                    {directions.map((d, i) => (
                      <div key={i} className="flex items-start gap-2 rounded-[10px] border border-[color:var(--hairline)] px-3 py-2">
                        <span className="shrink-0 text-sm font-medium tabular-nums text-[color:var(--accent)]">{i + 1}</span>
                        <span className="min-w-0 flex-1 text-sm leading-relaxed text-[color:var(--text-primary)]">{d}</span>
                        <button
                          disabled={streaming}
                          onClick={() => void send(`按这条走向往下写：${d}`, { command: "continue", mode: "write", targetChars: 800 })}
                          className={`${ACT} shrink-0 text-[color:var(--accent)]`}
                        >
                          按这条写
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div ref={bodyRef}>
                    <ReplyBody text={shown.content} mode={mode} />
                  </div>
                )}
                {agent && <AgentChanges changes={agent.changes} undone={agent.undone} canUndo={agent.canUndo} onToggle={() => useChat.getState().undoAgentTurn(shown.id)} />}
                <div
                  className={`flex flex-wrap items-center gap-0.5 transition-opacity duration-[var(--dur-md)] ${
                    isLast ? "opacity-100" : "opacity-0 group-hover/ai:opacity-100 focus-within:opacity-100"
                  }`}
                >
                  {picked && (
                    <span data-partial={picked.length} className="mr-1 rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] px-1.5 py-0.5 text-2xs text-[color:var(--accent)]">
                      只采纳选中的 {picked.replace(/\s/g, "").length} 字
                    </span>
                  )}
                  {output !== "chat" ? (
                    <span className="mr-1 flex items-stretch overflow-hidden rounded-[var(--r-control)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-2xs font-medium text-[color:var(--accent)]">
                      <button onMouseDown={(e) => e.preventDefault()} onClick={() => adopt(output === "replace" ? "replace" : "insert")} className="flex items-center gap-1 px-2 py-1 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                        {output === "replace" ? <Replace size={12} /> : <CornerDownLeft size={12} />}
                        {output === "replace" ? "替换选区" : "插入光标处"}
                      </button>
                      <button aria-label="更多采纳方式" onMouseDown={(e) => e.preventDefault()} onClick={(e) => adoptMenu(e.currentTarget)} className="border-l border-[color:color-mix(in_srgb,var(--accent)_25%,transparent)] px-1 transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]">
                        <ChevronDown size={12} />
                      </button>
                    </span>
                  ) : (
                    <button onMouseDown={(e) => e.preventDefault()} onClick={(e) => adoptMenu(e.currentTarget)} className={ACT} aria-label="采纳进正文">
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
                    <span className="flex items-center">
                      <button aria-label="重新生成" data-tip="重新生成（保留当前版本）" disabled={streaming} onClick={() => void regenerate(turn.user!.id)} className={ACT}>
                        <RefreshCw size={12} />
                      </button>
                      <button aria-label="带要求重新生成" data-tip="更长 / 更短 / 换个写法…" disabled={streaming} onClick={(e) => retryMenu(e.currentTarget)} className={`${ACT} -ml-1 px-0.5`}>
                        <ChevronDown size={11} />
                      </button>
                    </span>
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
                    aria-label={shown.starred ? "取消收藏" : "收藏到素材库"}
                    data-tip={shown.starred ? "已收藏（素材库「AI 收藏」）" : "收藏到素材库"}
                    disabled={shown.id < 0}
                    onClick={() => void starMessage(shown.id, !shown.starred)}
                    className={`${ACT} ${shown.starred ? "text-[color:var(--warning)]" : ""}`}
                  >
                    <Star size={12} fill={shown.starred ? "currentColor" : "none"} />
                  </button>
                  <button
                    aria-label="更多"
                    onClick={(e) =>
                      openMenuAt(e.currentTarget, [
                        { label: "从这里分叉为新对话", icon: GitBranch, disabled: shown.id < 0 || streaming, onSelect: () => void forkSession(shown.id) },
                        {
                          label: "抽取为…",
                          icon: Wand2,
                          submenu: (["character", "foreshadow", "plot"] as ExtractKind[]).map((k) => ({
                            label: EXTRACT_LABEL[k],
                            onSelect: () => void startExtract(k),
                          })),
                        },
                        { label: "存为本章梗概", icon: NotebookPen, onSelect: () => void saveAsSynopsis(shown) },
                        ...(shown.adopted && checkpointFor(shown.id) ? [{ label: "恢复到采纳之前", icon: History, onSelect: () => void restore(shown) }] : []),
                        { type: "separator" },
                        { label: "删除这个版本", icon: Trash2, danger: true, onSelect: () => void deleteMessage(shown.id) },
                      ])
                    }
                    className={ACT}
                  >
                    <MoreHorizontal size={12} />
                  </button>
                  <span className="ml-auto text-2xs tabular-nums text-[color:var(--text-faint)]" data-tip="字数 · 估算 token">
                    {shown.content.replace(/\s/g, "").length} 字 · ~{estimateTokens(shown.content)} tokens
                  </span>
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
