import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Loader2, Replace, X } from "lucide-react";
import { useWordSwap } from "../../stores/wordSwap";
import { getEditorFor } from "../../lib/editorBridge";
import { runTransient, type TransientRun } from "../../lib/ai/transient";
import { api, type TokenAlternatives } from "../../lib/tauri";
import { errMsg } from "../../lib/errors";
import { toast } from "../../stores/toast";
import type { PaneId } from "../../stores/workspace";

// 换个说法（阶段 2C）：近义词 / 成语替换（AI 给 8 个，Sudowrite Related Words）+ 此处最可能的字与概率
// （NovelAI 式 token 概率；服务商不回概率时只给近义词）。点一个即替换选中的词。

const MAX_WORD = 12;

/** 宽松解析字符串数组：JSON 数组优先，否则按、，换行切 */
export function parseWordList(text: string, exclude = ""): string[] {
  const body = text.replace(/```(?:json)?/gi, "");
  const a = body.indexOf("[");
  const b = body.lastIndexOf("]");
  let list: string[] = [];
  if (a >= 0 && b > a) {
    try {
      const v = JSON.parse(body.slice(a, b + 1));
      if (Array.isArray(v)) list = v.map((x) => String(x ?? ""));
    } catch {
      // 落到下面的切分
    }
  }
  if (list.length === 0) list = body.split(/[、，,\n]/);
  return [...new Set(list.map((s) => s.replace(/^["'「“\s\d.、]+|["'」”\s]+$/g, "").trim()).filter((s) => s && s !== exclude && s.length <= 20))];
}

export function WordSwap({ editor, chapterId, pane }: { editor: Editor; chapterId: number; pane: PaneId }) {
  const req = useWordSwap((s) => s.req);
  if (!req || req.pane !== pane) return null;
  return <Panel key={req.nonce} editor={editor} chapterId={chapterId} pane={pane} />;
}

function Panel({ editor, chapterId, pane }: { editor: Editor; chapterId: number; pane: PaneId }) {
  const close = useWordSwap((s) => s.close);
  const [range] = useState(() => {
    const { from, to, $from } = editor.state.selection;
    const word = editor.state.doc.textBetween(from, to, "", "").trim();
    if (!word || word.length > MAX_WORD || !$from.sameParent(editor.state.selection.$to)) return null;
    return { from, to, word, sentence: $from.parent.textContent, before: editor.state.doc.textBetween(0, from, "\n", " ") };
  });
  const [words, setWords] = useState<string[] | null>(null);
  const [alts, setAlts] = useState<TokenAlternatives | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const runRef = useRef<TransientRun | null>(null);

  useEffect(() => {
    if (!range) {
      toast.info(`先选中一个词（不超过 ${MAX_WORD} 字）`);
      close();
      return;
    }
    const run = runTransient({ kind: "synonyms", chapter_id: chapterId, text: range.sentence, selection: range.word });
    runRef.current = run;
    run.done.then((t) => setWords(parseWordList(t, range.word))).catch((e) => {
      setWords([]);
      toast.error(`近义词：${errMsg(e)}`);
    });
    api.aiTokenAlternatives(chapterId, range.before).then(setAlts, () => setAlts({ supported: false, tokens: [] }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      runRef.current?.cancel();
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    if (!range) return;
    try {
      const c = editor.view.coordsAtPos(range.to);
      setPos({ top: c.bottom + 6, left: Math.max(12, Math.min(c.left - 40, window.innerWidth - 332)) });
    } catch {
      setPos({ top: 120, left: 120 });
    }
  }, [editor, range]);

  if (!range) return null;
  const pick = (w: string) => {
    const bridge = getEditorFor(pane);
    if (!bridge?.replaceRange(range.from, range.to, range.word, w)) toast.error("原文已改动，没能替换");
    close();
    bridge?.focus();
  };
  const chip =
    "rounded-[var(--r-control)] px-2 py-1 text-xs text-[color:var(--text-primary)] transition-colors [box-shadow:inset_0_0_0_1px_var(--hairline)] hover:bg-[var(--fill-hover)]";
  return (
    <div
      data-testid="word-swap"
      style={{ position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? 0, width: 320 }}
      className="menu-pop z-40 flex flex-col gap-2 rounded-[10px] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] p-2 [box-shadow:var(--shadow-overlay)]"
    >
      <div className="flex items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
        <Replace size={12} className="text-[color:var(--accent)]" />
        <span className="min-w-0 flex-1 truncate">换个说法：「{range.word}」</span>
        <button aria-label="关闭" onClick={close} className="rounded p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
          <X size={12} />
        </button>
      </div>
      <div>
        <div className="mb-1 text-2xs text-[color:var(--text-faint)]">近义词 / 成语</div>
        {words == null ? (
          <Loader2 size={13} className="animate-spin text-[color:var(--text-faint)]" />
        ) : words.length === 0 ? (
          <div className="text-2xs text-[color:var(--text-faint)]">没有合适的</div>
        ) : (
          <div className="flex flex-wrap gap-1" data-synonyms={words.length}>
            {words.map((w) => (
              <button key={w} onClick={() => pick(w)} className={chip}>
                {w}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <div className="mb-1 text-2xs text-[color:var(--text-faint)]">此处最可能的字（模型概率）</div>
        {alts == null ? (
          <Loader2 size={13} className="animate-spin text-[color:var(--text-faint)]" />
        ) : !alts.supported || alts.tokens.length === 0 ? (
          <div className="text-2xs text-[color:var(--text-faint)]">当前服务商不提供概率</div>
        ) : (
          <div className="flex flex-wrap gap-1" data-alternatives={alts.tokens.length}>
            {alts.tokens.map((t) => (
              <button key={t.token} onClick={() => pick(t.token)} className={chip}>
                {t.token}
                <span className="ml-1 text-2xs tabular-nums text-[color:var(--text-faint)]">{Math.round(t.prob * 100)}%</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
