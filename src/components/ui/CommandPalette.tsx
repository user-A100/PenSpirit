import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CornerDownLeft, FileText, Search, TerminalSquare } from "lucide-react";
import { usePalette } from "../../stores/palette";
import { useWorkspace } from "../../stores/workspace";
import { useUiNav } from "../../lib/nav/uiStore";
import { formatCombo, getCommands, type Command } from "../../lib/commands";
import { fuzzyMatch } from "../../lib/pinyin";

// 命令面板（阶段 1；Zen 浮动地址栏手法：居中偏上、大圆角、深阴影、选中行 accent）。
// 默认混搜「章节 / 书 / 命令」；输入以 ">" 开头只搜命令。支持拼音首字母（lw → 林晚）。
// Enter 执行；Ctrl+Enter 在另一窗格打开章节；↑↓ 选择；Esc 关闭。

type Item =
  | { kind: "chapter"; id: number; title: string; sub: string; score: number; range?: [number, number] }
  | { kind: "book"; id: number; title: string; score: number; range?: [number, number] }
  | { kind: "command"; cmd: Command; score: number; range?: [number, number]; enabled: boolean };

const GROUP_LABEL: Record<Item["kind"], string> = { chapter: "章节", book: "书", command: "命令" };
const MAX_PER_GROUP = 8;

function Highlight({ text, range }: { text: string; range?: [number, number] }) {
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark className="rounded-[2px] bg-transparent text-[color:var(--accent)]">{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

export function CommandPalette() {
  const open = usePalette((s) => s.open);
  const initial = usePalette((s) => s.initial);
  const seq = usePalette((s) => s.seq);
  const close = usePalette((s) => s.close);
  const chapters = useWorkspace((s) => s.chapters);
  const books = useWorkspace((s) => s.books);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const history = useWorkspace((s) => s.history);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initial);
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, seq, initial]);

  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    const commandsOnly = query.startsWith(">");
    const q = commandsOnly ? query.slice(1) : query;
    const out: Item[] = [];
    if (!commandsOnly) {
      if (q.trim() === "") {
        // 空查询：最近打开的章（历史倒序去重）
        const seen = new Set<number>();
        for (let i = history.length - 1; i >= 0 && seen.size < 5; i--) {
          const c = chapters.find((x) => x.id === history[i]);
          if (c && !seen.has(c.id)) {
            seen.add(c.id);
            out.push({ kind: "chapter", id: c.id, title: c.title, sub: `${c.word_count.toLocaleString()} 字`, score: 1 });
          }
        }
      } else {
        const ch: Item[] = [];
        for (const c of chapters) {
          const m = fuzzyMatch(q, c.title);
          if (m) ch.push({ kind: "chapter", id: c.id, title: c.title, sub: `${c.word_count.toLocaleString()} 字`, score: m.score, range: m.range });
        }
        ch.sort((a, b) => b.score - a.score);
        out.push(...ch.slice(0, MAX_PER_GROUP));
        const bk: Item[] = [];
        for (const b of books) {
          if (b.id === currentBookId) continue;
          const m = fuzzyMatch(q, b.title);
          if (m) bk.push({ kind: "book", id: b.id, title: b.title, score: m.score, range: m.range });
        }
        bk.sort((a, b) => b.score - a.score);
        out.push(...bk.slice(0, 4));
      }
    }
    const cmds: Item[] = [];
    for (const c of getCommands()) {
      if (c.id.startsWith("palette.")) continue;
      const m = fuzzyMatch(q, c.title) ?? (c.category ? fuzzyMatch(q, c.category) : null);
      if (!m) continue;
      cmds.push({ kind: "command", cmd: c, score: m.score - (m.range ? 0 : 5), range: m.range, enabled: !c.when || c.when() });
    }
    cmds.sort((a, b) => b.score - a.score);
    out.push(...cmds.slice(0, commandsOnly || q.trim() !== "" ? 12 : 6));
    return out;
  }, [open, query, chapters, books, currentBookId, history]);

  useEffect(() => {
    if (active >= items.length) setActive(Math.max(0, items.length - 1));
  }, [items.length, active]);

  // 选中项滚入可视区
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const run = async (it: Item, alt: boolean) => {
    close();
    const nav = useUiNav.getState();
    if (it.kind === "chapter") {
      if (nav.activeView !== "write") nav.setView("write");
      const ws = useWorkspace.getState();
      if (alt) {
        if (ws.splitAxis === "none") ws.setSplitAxis("vertical");
        ws.focusPane(ws.activePane === "a" ? "b" : "a");
      }
      await useWorkspace.getState().selectChapter(it.id);
    } else if (it.kind === "book") {
      await useWorkspace.getState().selectBook(it.id);
    } else if (it.enabled) {
      await it.cmd.run();
    }
  };

  return (
    <div className="fixed inset-0 z-[240] flex justify-center bg-black/20 pt-[14vh]" onMouseDown={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        onMouseDown={(e) => e.stopPropagation()}
        className="palette-in flex max-h-[64vh] w-[min(640px,92vw)] flex-col self-start overflow-hidden rounded-[14px] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] [box-shadow:var(--shadow-overlay)]"
      >
        <div className="flex h-12 shrink-0 items-center gap-2.5 px-4 [box-shadow:inset_0_-1px_0_var(--hairline)]">
          {query.startsWith(">") ? (
            <TerminalSquare size={17} className="shrink-0 text-[color:var(--accent)]" />
          ) : (
            <Search size={17} className="shrink-0 text-[color:var(--text-faint)]" />
          )}
          <input
            ref={inputRef}
            value={query}
            aria-label="搜索章节、书与命令"
            placeholder="跳到章节、切换书，或输入 > 执行命令（支持拼音首字母）"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const it = items[active];
                if (it) void run(it, e.ctrlKey || e.metaKey);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-md text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox" aria-label="结果">
          {items.length === 0 && (
            <div className="px-3 py-6 text-center text-ui text-[color:var(--text-faint)]">没有匹配的章节或命令</div>
          )}
          {items.map((it, i) => {
            const groupStart = i === 0 || items[i - 1].kind !== it.kind;
            const isActive = i === active;
            const title = it.kind === "command" ? it.cmd.title : it.title;
            const Icon = it.kind === "chapter" ? FileText : it.kind === "book" ? BookOpen : TerminalSquare;
            const disabled = it.kind === "command" && !it.enabled;
            return (
              <div key={`${it.kind}-${it.kind === "command" ? it.cmd.id : it.id}`}>
                {groupStart && (
                  <div className="px-2.5 pb-1 pt-2 text-2xs font-medium text-[color:var(--text-faint)]">
                    {query.trim() === "" && it.kind === "chapter" ? "最近" : GROUP_LABEL[it.kind]}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={disabled || undefined}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={(e) => void run(it, e.ctrlKey || e.metaKey)}
                  className={`flex h-9 cursor-default items-center gap-2.5 rounded-[var(--r-control)] px-2.5 text-ui ${
                    isActive ? "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[color:var(--text-primary)]" : "text-[color:var(--text-secondary)]"
                  } ${disabled ? "opacity-45" : ""}`}
                >
                  <Icon size={15} strokeWidth={1.75} className={`shrink-0 ${isActive ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <Highlight text={title} range={it.range} />
                  </span>
                  {it.kind === "chapter" && <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-faint)]">{it.sub}</span>}
                  {it.kind === "command" && it.cmd.keys?.[0] && (
                    <kbd className="shrink-0 rounded-[4px] px-1.5 py-px font-sans text-2xs text-[color:var(--text-faint)] [box-shadow:inset_0_0_0_1px_var(--hairline)]">
                      {formatCombo(it.cmd.keys[0])}
                    </kbd>
                  )}
                  {isActive && <CornerDownLeft size={13} className="shrink-0 text-[color:var(--text-faint)]" />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex h-8 shrink-0 items-center gap-4 px-4 text-2xs text-[color:var(--text-faint)] [box-shadow:inset_0_1px_0_var(--hairline)]">
          <span>↑↓ 选择</span>
          <span>Enter 打开</span>
          <span>Ctrl+Enter 在另一窗格打开</span>
          <span className="ml-auto">&gt; 只搜命令</span>
        </div>
      </div>
    </div>
  );
}
