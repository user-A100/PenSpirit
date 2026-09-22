import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ArrowLeft,
  ArrowRight,
  History,
  ListTree,
  PanelRightOpen,
  PenLine,
  ScanSearch,
  SquareSplitHorizontal,
  SquareSplitVertical,
} from "lucide-react";
import { useWorkspace, type PaneId } from "../../stores/workspace";
import { useChat } from "../../stores/chat";
import { useSearch } from "../../stores/search";
import { useOutline } from "../../stores/outline";
import { localMinute, useStats } from "../../stores/stats";
import { useUiNav } from "../../lib/nav/uiStore";
import { api } from "../../lib/tauri";
import { useAutosave } from "../../hooks/useAutosave";
import { countWords } from "../../lib/words";
import { HistoryPanel } from "./HistoryPanel";
import { PlaceholderDialog } from "./PlaceholderDialog";
import { SensitiveDialog } from "./SensitiveDialog";
import { FloatingOutline } from "./FloatingOutline";
import { WikiLinks } from "./wikiLinks";
import { WikiSuggest } from "./WikiSuggest";

// 单次字数跳变超过它就丢弃：切章/恢复快照/清空这类程序化改动的特征
const MAX_WORD_DELTA = 500;

/** 在文档里找首个包含 needle 的文本区间（不跨文本节点，作为「跳到此行」的近似定位足够） */
function findTextPos(doc: PMNode, needle: string): { from: number; to: number } | null {
  const target = needle.toLowerCase();
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text) return;
    const idx = node.text.toLowerCase().indexOf(target);
    if (idx >= 0) found = { from: pos + idx, to: pos + idx + needle.length };
  });
  return found;
}

export function ChapterEditor({ pane = "a" }: { pane?: PaneId }) {
  // 内容来自所属窗格槽位（而非全局镜像）——分屏时两个编辑器互不干扰
  const slot = useWorkspace((s) => s.panes[pane]);
  const books = useWorkspace((s) => s.books);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const chapters = useWorkspace((s) => s.chapters);
  const isActive = useWorkspace((s) => s.activePane === pane);
  const canBack = useWorkspace((s) => s.historyIndex > 0);
  const canForward = useWorkspace((s) => s.historyIndex < s.history.length - 1);
  const splitAxis = useWorkspace((s) => s.splitAxis);
  const chapterId = slot?.chapterId ?? null;
  const content = slot?.content ?? null;
  const pendingAppend = useChat((s) => s.pendingAppend);
  const jumpText = useSearch((s) => s.jumpText);
  const outlineOpen = useOutline((s) => s.open);
  const outlineJump = useOutline((s) => s.jumpTarget);
  const typewriter = useUiNav((s) => s.typewriter);
  const toggleTypewriter = useUiNav((s) => s.toggleTypewriter);
  const dirty = useRef<string | null>(null);
  const chapterIdRef = useRef<number | null>(null);
  chapterIdRef.current = chapterId;
  const bookIdRef = useRef<number | null>(null);
  bookIdRef.current = currentBookId;
  // 程序化改动（切章/恢复/AI 采纳）期间置位，其 transaction 不计入今日写作
  const suppressStats = useRef(false);
  // 打字机滚动的实时开关（onTransaction 闭包里读 ref，避免重建编辑器）
  const typewriterRef = useRef(false);
  typewriterRef.current = typewriter;
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // 上一次计入活跃的分钟串——同一分钟只记一次
  const lastMinute = useRef<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sensitiveOpen, setSensitiveOpen] = useState(false);
  // 「检查」下拉（M4-T6：敏感词 + 占位符两项）
  const [checkOpen, setCheckOpen] = useState(false);
  const [placeholderOpen, setPlaceholderOpen] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown, WikiLinks],
    content: "",
    immediatelyRender: false,
    // wiki 链接点击跳转（M7 批次3）：[[章题]] 是纯文本装饰，同书章题精确匹配选中
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          const el = (event.target as HTMLElement).closest?.(".wiki-link") as HTMLElement | null;
          const target = el?.getAttribute("data-wiki");
          if (!target) return false;
          const ch = useWorkspace.getState().chapters.find((c) => c.title === target);
          if (ch) void useWorkspace.getState().selectChapter(ch.id);
          return false;
        },
      },
    },
    // 点进哪个窗格，哪个窗格成为活动窗格（侧栏高亮/dock 面板/AI 会话跟随）
    onFocus: () => {
      const ws = useWorkspace.getState();
      if (ws.activePane !== pane) ws.focusPane(pane);
    },
    onUpdate: ({ editor: ed }) => {
      dirty.current = (ed.storage.markdown as { getMarkdown(): string }).getMarkdown();
    },
    // M2-T11 差量统计：按字计（与章节字数同一口径），粘贴与程序化改动不计
    onTransaction: ({ editor: ed, transaction: tr }) => {
      // 打字机滚动（M7 批次5）：光标行固定在视口偏上位置，只跟用户的输入/移动
      if (typewriterRef.current && (tr.docChanged || tr.selectionSet)) {
        requestAnimationFrame(() => {
          const scroller = scrollerRef.current;
          if (!scroller || !ed.view.hasFocus()) return;
          const rect = ed.view.coordsAtPos(ed.state.selection.head);
          const sr = scroller.getBoundingClientRect();
          const target = sr.top + Math.min(sr.height * 0.4, 220);
          const delta = rect.top - target;
          if (Math.abs(delta) > 2) scroller.scrollTop += delta;
        });
      }
      if (!tr.docChanged || suppressStats.current) return;
      // 粘贴整段不算"写"（ProseMirror 的粘贴处理器会打上 paste meta）
      if (tr.getMeta("paste") || tr.getMeta("uiEvent") === "paste") return;
      const bookId = bookIdRef.current;
      if (bookId == null) return;
      // tr.before 是（步骤应用前的）ProseMirror Node，tr.doc 是新的
      const delta = countWords(tr.doc.textContent) - countWords(tr.before.textContent);
      // 跳变过大 = 切章/恢复/清空等程序化改动（上一条是兜底，正常输入不会触及）
      if (delta === 0 || Math.abs(delta) > MAX_WORD_DELTA) return;

      const minute = localMinute();
      const countMinute = lastMinute.current !== minute;
      lastMinute.current = minute;
      void useStats.getState().record(bookId, delta, countMinute);
    },
  });

  useEffect(() => {
    if (editor && content != null) {
      suppressStats.current = true;
      editor.commands.setContent(content);
      suppressStats.current = false;
      dirty.current = null;
    }
  }, [chapterId, content, editor]);

  // 搜索结果跳转：正文就位后定位到首个匹配并滚动到可见（本 effect 声明在灌内容之后，
  // 故同一次提交里 chapterContent 先落地）。只在活动窗格消费——搜索跳装载的章在活动窗格。
  // 消费后清空，避免重复定位。
  useEffect(() => {
    if (!editor || !isActive || jumpText == null) return;
    const pos = findTextPos(editor.state.doc, jumpText);
    if (pos) {
      editor.commands.setTextSelection(pos);
      editor.commands.scrollIntoView();
    }
    useSearch.getState().clearJump();
  }, [editor, isActive, content, jumpText]);

  // 悬浮大纲跳转：与搜索跳转同款定位，同样只在活动窗格消费；consume 自取自清（一次性）
  useEffect(() => {
    if (!editor || !isActive || outlineJump == null) return;
    const pos = findTextPos(editor.state.doc, outlineJump);
    if (pos) {
      editor.commands.setTextSelection(pos);
      editor.commands.scrollIntoView();
    }
    useOutline.getState().consume();
  }, [editor, isActive, content, outlineJump]);

  // 消费 AI 采纳：把文本以空行分隔追加到文档末尾（文档为空时不加前导空行），
  // 只在活动窗格消费（AI 会话跟随活动窗格章节）。
  // 显式置 dirty 交给自动保存，然后清空通道。清空本身触发重渲染，驱动 autosave effect。
  useEffect(() => {
    if (!editor || !isActive || pendingAppend == null) return;
    const docEmpty = editor.state.doc.textContent.trim() === "";
    // AI 采纳不计入今日手写字数
    suppressStats.current = true;
    editor.commands.insertContentAt(
      editor.state.doc.content.size,
      docEmpty ? pendingAppend : `\n\n${pendingAppend}`,
    );
    suppressStats.current = false;
    dirty.current = (editor.storage.markdown as { getMarkdown(): string }).getMarkdown();
    useChat.getState().clearPendingAppend();
  }, [pendingAppend, editor]);

  const { status } = useAutosave(
    () => dirty.current,
    async (content) => {
      const id = chapterIdRef.current;
      if (id == null) return;
      await api.writeChapter(id, content);
    },
  );

  const currentMarkdown = () =>
    editor ? (editor.storage.markdown as { getMarkdown(): string }).getMarkdown() : "";

  // 版本恢复：把快照文本灌进编辑器并显式置 dirty（TipTap 的 setContent 不触发 onUpdate），
  // 落盘交给上面的自动保存——与 AI 采纳路径同构。
  const restoreFromHistory = (content: string) => {
    if (!editor) return;
    suppressStats.current = true;
    editor.commands.setContent(content);
    suppressStats.current = false;
    dirty.current = (editor.storage.markdown as { getMarkdown(): string }).getMarkdown();
  };

  const book = books.find((b) => b.id === currentBookId);
  const meta = chapters.find((c) => c.id === chapterId);
  // dock 折叠后的展开入口（模仿侧栏在 Ribbon 底部的条件性展开按钮）：
  // 折叠时整个 dock 被 CSS 摘除，按钮必须挂在编辑器这侧才能被点到
  const dockCollapsed = useUiNav((s) => s.dockCollapsed);
  const toggleDock = useUiNav((s) => s.toggleDock);

  if (chapterId == null) {
    return (
      <div
        onClick={() => useWorkspace.getState().focusPane(pane)}
        className="relative flex h-full cursor-default flex-col items-center justify-center gap-3 bg-transparent"
      >
        {/* 空态也没有顶部栏——dock 折叠时的展开入口挂这里（同顶栏按钮） */}
        {dockCollapsed && (
          <button
            onClick={toggleDock}
            title="展开右侧面板（Ctrl+\\）"
            className="absolute right-3 top-3 rounded p-1.5 text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <PanelRightOpen size={15} />
          </button>
        )}
        <PenLine size={32} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
        <div className="text-sm text-[color:var(--text-secondary)]">
          {pane === "b" ? "点击此处聚焦，再从左侧目录选一章在本窗打开" : "选择或创建一个章节开始写作"}
        </div>
        {pane === "a" && <div className="text-xs text-[color:var(--text-faint)]">Ctrl+N 快速新建（即将支持）</div>}
      </div>
    );
  }

  const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ") ?? "";

  return (
    <div className="relative flex h-full flex-col bg-transparent">
      {/* 顶部栏 40px：面包屑 + 保存状态 + 字数 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] pl-4 pr-5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate text-[color:var(--text-secondary)]">{book?.title ?? ""}</span>
          <span className="shrink-0 text-[color:var(--text-faint)]">/</span>
          <span className="truncate text-[color:var(--text-primary)]">{meta?.title ?? ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-[color:var(--text-faint)]">
          {/* 导航历史：浏览器式后退/前进，作用于活动窗格 */}
          <span className="flex items-center gap-0.5">
            <button
              onClick={() => void useWorkspace.getState().goBack()}
              disabled={!canBack}
              title="后退（Alt+←）"
              className="rounded p-1 transition-colors duration-150 enabled:hover:bg-[var(--bg-hover)] enabled:hover:text-[color:var(--text-primary)] disabled:opacity-40"
            >
              <ArrowLeft size={14} />
            </button>
            <button
              onClick={() => void useWorkspace.getState().goForward()}
              disabled={!canForward}
              title="前进（Alt+→）"
              className="rounded p-1 transition-colors duration-150 enabled:hover:bg-[var(--bg-hover)] enabled:hover:text-[color:var(--text-primary)] disabled:opacity-40"
            >
              <ArrowRight size={14} />
            </button>
          </span>
          <button
            onClick={() => useWorkspace.getState().cycleSplit()}
            title="分屏：全部/左右/上下循环切换（Alt+S）"
            className={`rounded p-1 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
              splitAxis !== "none" ? "text-[color:var(--accent)]" : ""
            }`}
          >
            {splitAxis === "horizontal" ? <SquareSplitVertical size={14} /> : <SquareSplitHorizontal size={14} />}
          </button>
          <button
            onClick={toggleTypewriter}
            title="打字机滚动：光标行固定在视口偏上位置"
            className={`rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
              typewriter ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]" : ""
            }`}
          >
            打字机
          </button>
          <button
            onClick={() => useOutline.getState().toggle()}
            title="悬浮大纲"
            className={`rounded p-1 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
              outlineOpen ? "text-[color:var(--accent)]" : ""
            }`}
          >
            <ListTree size={14} />
          </button>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            title="版本历史"
            className={`rounded p-1 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
              historyOpen ? "text-[color:var(--accent)]" : ""
            }`}
          >
            <History size={14} />
          </button>
          <div className="relative">
            <button
              onClick={() => setCheckOpen((v) => !v)}
              title="检查"
              className={`rounded p-1 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] ${
                checkOpen ? "text-[color:var(--accent)]" : ""
              }`}
            >
              <ScanSearch size={14} />
            </button>
            {checkOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setCheckOpen(false)} />
                <div className="absolute right-0 top-full z-20 mt-1 w-32 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 text-xs [box-shadow:var(--shadow-pop)]">
                  <button
                    onClick={() => { setCheckOpen(false); setSensitiveOpen(true); }}
                    className="block w-full px-3 py-1.5 text-left text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                  >
                    敏感词检查
                  </button>
                  <button
                    onClick={() => { setCheckOpen(false); setPlaceholderOpen(true); }}
                    className="block w-full px-3 py-1.5 text-left text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                  >
                    占位符扫描
                  </button>
                </div>
              </>
            )}
          </div>
          {status !== "idle" && (
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "saving" ? "animate-pulse bg-[color:var(--warning)]" : "bg-[color:var(--success)]"
                }`}
              />
              {status === "saving" ? "保存中" : "已保存"}
            </span>
          )}
          <span>{countWords(text).toLocaleString()} 字</span>
          {dockCollapsed && isActive && (
            <button
              onClick={toggleDock}
              title="展开右侧面板（Ctrl+\\）"
              className="rounded p-1 text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <PanelRightOpen size={14} />
            </button>
          )}
        </div>
      </div>

      {/* 正文：720px 单列衬线排版，无边框融入背景；[[章题]] 补全浮层 fixed 定位不占版面。
          scrollerRef 供打字机滚动定位光标行。 */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="prose-serif mx-auto max-w-[720px] px-8 py-10" />
        <WikiSuggest editor={editor} />
      </div>

      {historyOpen && (
        <HistoryPanel
          chapterId={chapterId}
          getCurrentContent={currentMarkdown}
          onRestore={restoreFromHistory}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* 打开时快照当前正文——弹层是模态的，期间不会有编辑 */}
      {sensitiveOpen && (
        <SensitiveDialog content={currentMarkdown()} onClose={() => setSensitiveOpen(false)} />
      )}
      {placeholderOpen && (
        <PlaceholderDialog content={currentMarkdown()} onClose={() => setPlaceholderOpen(false)} />
      )}

      {/* 悬浮大纲：fixed 定位不占版面；正文传编辑器实时 markdown，大纲随写随刷。
          大纲是全局浮层，只在活动窗格挂载，避免分屏时出现两份。 */}
      {isActive && <FloatingOutline markdown={currentMarkdown()} />}
    </div>
  );
}
