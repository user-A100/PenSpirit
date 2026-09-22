import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { CornerDownLeft } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { openWiki, wikiCandidates } from "../../lib/wiki";

// wiki 链接自动补全（M7 批次3）：光标前悬着未闭合的 `[[查询` 时浮出章题候选。
// 纯 React 层实现（监听 transaction），选中后把 `[[查询` 闭合成 `[[章题]]`
// 纯文本——与装饰层同口径，不引入 mark，落盘 markdown 保持原样。

interface SuggestState {
  /** `[[` 起点的文档坐标 */
  from: number;
  query: string;
}

export function WikiSuggest({ editor }: { editor: Editor | null }) {
  const chapters = useWorkspace((s) => s.chapters);
  const [state, setState] = useState<SuggestState | null>(null);
  const [selected, setSelected] = useState(0);
  const stateRef = useRef<SuggestState | null>(null);
  stateRef.current = state;
  const selectedRef = useRef(0);
  selectedRef.current = selected;
  const candidatesRef = useRef<string[]>([]);
  const candidates = state
    ? wikiCandidates(state.query, chapters.map((c) => c.title))
    : [];
  candidatesRef.current = candidates;

  // 每次事务后重算：光标所在段内、光标前文本是否匹配未闭合的 [[
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { $from } = editor.state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
      const open = openWiki(textBefore);
      setState(
        open
          ? { from: $from.pos - (textBefore.length - open.from), query: open.query }
          : null,
      );
      setSelected(0);
    };
    editor.on("transaction", update);
    return () => {
      editor.off("transaction", update);
    };
  }, [editor]);

  const accept = (index: number) => {
    const st = stateRef.current;
    const cands = candidatesRef.current;
    const title = cands[index];
    if (!st || !editor || title == null) return;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: st.from, to: st.from + 2 + st.query.length }, `[[${title}]]`)
      .run();
    setState(null);
  };

  // 浮层打开时捕获编辑器按键：↑↓ 选人 / Enter 闭合 / Esc 关闭（抢在 TipTap 之前）
  const open = state != null && candidates.length > 0;
  useEffect(() => {
    if (!editor || !open) return;
    const dom = editor.view.dom;
    const onKeyDown = (e: KeyboardEvent) => {
      const count = candidatesRef.current.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((v) => (e.key === "ArrowDown" ? Math.min(count - 1, v + 1) : Math.max(0, v - 1)));
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        accept(selectedRef.current);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setState(null);
      }
    };
    dom.addEventListener("keydown", onKeyDown, true);
    return () => dom.removeEventListener("keydown", onKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, open]);

  if (!editor || !state || candidates.length === 0) return null;

  const coords = editor.view.coordsAtPos(state.from);
  return (
    <div
      className="fixed z-50 max-h-56 w-56 overflow-y-auto rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 text-xs [box-shadow:var(--shadow-pop)]"
      style={{ left: coords.left, top: coords.bottom + 4 }}
      data-testid="wiki-suggest"
    >
      {candidates.map((t, i) => (
        <button
          key={t}
          onMouseDown={(e) => {
            e.preventDefault();
            accept(i);
          }}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left transition-colors duration-150 ${
            i === selected
              ? "bg-[var(--accent-dim)] text-[color:var(--accent)]"
              : "text-[color:var(--text-secondary)]"
          }`}
        >
          <span className="min-w-0 flex-1 truncate">{t}</span>
          {i === selected && <CornerDownLeft size={11} className="shrink-0" />}
        </button>
      ))}
    </div>
  );
}
