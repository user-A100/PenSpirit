import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Check, CornerDownLeft, RefreshCw, Sparkles, X } from "lucide-react";
import { useInlineAi, type InlineMode } from "../../stores/inlineAi";
import { getEditorFor } from "../../lib/editorBridge";
import { runTransient, type TransientRun } from "../../lib/ai/transient";
import { cleanAiText } from "../../lib/ai/cleanText";
import { addTint } from "../../lib/ai/aiTint";
import { takeCheckpoint } from "../../lib/ai/checkpoint";
import { errMsg } from "../../lib/errors";
import { toast } from "../../stores/toast";
import type { PaneId } from "../../stores/workspace";
import { aiTintKey } from "./aiTint";
import { CharDiff } from "../chat/DiffReview";
import { directiveAt } from "../../lib/ai/directives";

// 就地 AI 浮条（阶段 2B）：
//  · Alt+K 就地改写：选区（无选区 = 光标所在段）→ 输入要求 → 流式出改写稿，浮条内看逐字差异 → 应用 / 重试 / 丢弃
//  · Alt+Enter 光标处续写：直接开写，浮条内预览 → 应用（插到光标处）/ 重试（可补一句要求）/ 丢弃
// 生成走一次性通道（不进对话历史），上下文与对话同一条管线（记忆、规则、设定卡、前后文）。
// 应用前强制快照（检查点），写入后记进 AI 着色；Enter 应用、Esc 丢弃。

const PANEL_W = 460;

interface Range {
  from: number;
  to: number;
  selection: string;
  before: string;
  after: string;
  /** 阶段 2C：光标在 [待写指令] 里——按它写，应用时替换整个方括号 */
  directive?: string;
}

function initialRange(editor: Editor, mode: InlineMode): Range | null {
  const { state } = editor;
  let { from, to } = state.selection;
  if (mode === "edit" && from === to) {
    const $f = state.selection.$from;
    if (!$f.parent.isTextblock || $f.parent.content.size === 0) return null;
    from = $f.start();
    to = $f.end();
  }
  let directive: string | undefined;
  if (mode === "continue") {
    from = to;
    // 光标落在 [待写指令] 里：取指令、区间扩到整个方括号（只处理纯文本段，偏移才对得上）
    const $c = state.selection.$to;
    let plain = $c.parent.isTextblock;
    $c.parent.forEach((ch) => {
      if (!ch.isText) plain = false;
    });
    const d = plain ? directiveAt($c.parent.textContent, $c.parentOffset) : null;
    if (d) {
      from = $c.start() + d.from;
      to = $c.start() + d.to;
      directive = d.inner;
    }
  }
  const doc = state.doc;
  return {
    from,
    to,
    selection: doc.textBetween(from, to, "\n", " "),
    before: doc.textBetween(0, from, "\n", " "),
    after: doc.textBetween(to, doc.content.size, "\n", " "),
    directive,
  };
}

export function InlineAi({ editor, chapterId, pane }: { editor: Editor; chapterId: number; pane: PaneId }) {
  const req = useInlineAi((s) => s.req);
  if (!req || req.pane !== pane) return null;
  return <InlinePanel key={req.nonce} editor={editor} chapterId={chapterId} pane={pane} mode={req.mode} />;
}

function InlinePanel({ editor, chapterId, pane, mode }: { editor: Editor; chapterId: number; pane: PaneId; mode: InlineMode }) {
  const close = useInlineAi((s) => s.close);
  const [range] = useState(() => initialRange(editor, mode));
  const [instruction, setInstruction] = useState("");
  const [status, setStatus] = useState<"input" | "running" | "done" | "error">(mode === "continue" ? "running" : "input");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const runRef = useRef<TransientRun | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // 待改区高亮（装饰随编辑映射）；卸载时清掉、取消未完成的生成
  useEffect(() => {
    if (!range) {
      toast.error("先选中要改的文字，或把光标放进要改的段落");
      close();
      return;
    }
    editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { pending: { from: range.from, to: range.to } }));
    return () => {
      runRef.current?.cancel();
      if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { pending: null }));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mapped = () => aiTintKey.getState(editor.state)?.pending ?? (range ? { from: range.from, to: range.to } : null);

  // 浮条贴在待改区下方；滚动 / 窗口变化时跟随
  useLayoutEffect(() => {
    const place = () => {
      const r = mapped();
      if (!r || editor.isDestroyed) return;
      try {
        const c = editor.view.coordsAtPos(r.to);
        // 与正文栏左对齐、贴在待改区下方（不压在行尾右侧）
        const col = editor.view.dom.getBoundingClientRect().left;
        const left = Math.max(12, Math.min(col, window.innerWidth - PANEL_W - 12));
        const h = panelRef.current?.offsetHeight ?? 120;
        const below = c.bottom + 8;
        const top = below + h > window.innerHeight - 8 ? Math.max(8, c.top - h - 8) : below;
        setPos({ top, left });
      } catch {
        // 位置失效（文档变短）：保持上次位置
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  });

  const start = (extra = instruction) => {
    if (!range) return;
    runRef.current?.cancel();
    setStatus("running");
    setText("");
    setError(null);
    const run = runTransient(
      {
        kind: mode === "edit" ? "inline_edit" : "continue",
        chapter_id: chapterId,
        before: range.before,
        after: range.after,
        selection: range.selection,
        instruction:
          mode === "edit"
            ? extra.trim() || "润色，让表达更准确流畅"
            : range.directive
              ? `按这条指令写一段正文：${range.directive}${extra.trim() ? `；${extra.trim()}` : ""}`
              : extra.trim(),
        target_chars: mode === "continue" ? 300 : null,
      },
      (all) => setText(all),
    );
    runRef.current = run;
    run.done
      .then((full) => {
        if (runRef.current !== run) return;
        setText(full);
        setStatus(full.trim() ? "done" : "error");
        if (!full.trim()) setError("AI 没有返回内容");
      })
      .catch((e) => {
        if (runRef.current !== run) return;
        setError(errMsg(e));
        setStatus("error");
      });
  };

  // 续写：打开即生成
  useEffect(() => {
    if (mode === "continue" && range) start("");
    else inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (status === "done") panelRef.current?.focus();
  }, [status]);

  const apply = async () => {
    const r = mapped();
    const bridge = getEditorFor(pane);
    const out = cleanAiText(text, { prose: true });
    if (!r || !bridge || !range || !out) return;
    const cp = await takeCheckpoint(bridge);
    const ok =
      mode === "edit" || range.directive
        ? bridge.replaceRange(r.from, r.to, range.selection, out)
        : bridge.insertAt
          ? bridge.insertAt(r.to, out)
          : bridge.insertAtCursor(out);
    if (!ok) {
      toast.error(mode === "edit" ? "原文已改动，找不到要替换的段落" : "插入失败：编辑器不可用");
      return;
    }
    close();
    const snippets = await addTint(chapterId, out);
    bridge.setTint?.(snippets);
    void cp;
    toast.success(mode === "edit" ? "已就地改写（采纳前已存快照）" : "已续写到光标处", { action: { label: "撤销", run: () => bridge.undo() } });
  };

  // Esc 随时丢弃——生成中焦点还在正文里，所以挂在 window 捕获阶段而不是浮条自身
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      close();
      if (!editor.isDestroyed) editor.commands.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, editor]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" && !e.shiftKey && status === "done" && e.target === panelRef.current) {
      e.preventDefault();
      void apply();
    }
  };

  if (!range) return null;
  const busy = status === "running";
  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      data-inline-ai={mode}
      data-status={status}
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? 0, width: PANEL_W }}
      className="menu-pop z-40 flex flex-col gap-2 rounded-[10px] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] p-2 text-xs outline-none [box-shadow:var(--shadow-overlay)]"
    >
      <div className="flex items-center gap-1.5">
        <Sparkles size={13} className="shrink-0 text-[color:var(--accent)]" />
        {mode === "edit" || status !== "running" ? (
          <input
            ref={inputRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                e.stopPropagation();
                start();
              }
            }}
            aria-label={mode === "edit" ? "怎么改" : "补充要求"}
            placeholder={mode === "edit" ? "怎么改？如「更紧张」「改成第一人称」（留空 = 润色）" : range.directive ? `按「${range.directive}」重写时补充要求（可留空）` : "补充一句要求再重写（可留空）"}
            className="h-7 min-w-0 flex-1 bg-transparent text-ui text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[color:var(--text-secondary)]" data-inline-directive={range.directive ?? undefined}>
            {range.directive ? `按指令写：${range.directive}` : "正在续写…"}
          </span>
        )}
        <button aria-label="丢弃" data-tip="丢弃（Esc）" onClick={() => (close(), editor.commands.focus())} className="shrink-0 rounded-[4px] p-1 text-[color:var(--text-faint)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]">
          <X size={13} />
        </button>
      </div>
      {(text || busy) && (
        <div className="prose-serif max-h-64 overflow-y-auto whitespace-pre-wrap rounded-[var(--r-control)] bg-[var(--fill-element)] px-3 py-2 text-sm leading-relaxed" data-inline-ai-text="">
          {mode === "edit" ? <CharDiff before={range.selection} after={text} /> : <span className="text-[color:var(--text-secondary)]">{text}</span>}
          {busy && <span className="ai-caret">▍</span>}
        </div>
      )}
      {error && <div className="text-[color:var(--danger)]">{error}</div>}
      {status !== "input" && (
        <div className="flex items-center justify-end gap-1">
          <button
            disabled={busy}
            onClick={() => start()}
            className="flex items-center gap-1 rounded-[var(--r-control)] px-2 py-1 text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] disabled:opacity-40"
          >
            <RefreshCw size={12} /> 重试
          </button>
          {busy ? (
            <button onClick={() => runRef.current?.cancel()} className="rounded-[var(--r-control)] px-2 py-1 text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)]">
              停止
            </button>
          ) : (
            <button
              disabled={status !== "done"}
              onClick={() => void apply()}
              className="flex items-center gap-1 rounded-[var(--r-control)] bg-[var(--accent-solid)] px-2.5 py-1 font-medium text-white disabled:opacity-40"
            >
              <Check size={12} /> 应用 <CornerDownLeft size={11} className="opacity-70" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
