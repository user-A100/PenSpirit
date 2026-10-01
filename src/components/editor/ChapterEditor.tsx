import { BubbleMenu, EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useState } from "react";
import type { Node as PMNode } from "@tiptap/pm/model";
import {
  ArrowLeft,
  ArrowRight,
  History,
  ListTree,
  Maximize2,
  MoreHorizontal,
  PenLine,
  Pencil,
  ScanSearch,
  SquareSplitHorizontal,
  SquareSplitVertical,
  Trash2,
  Type,
  Scissors,
  Highlighter,
  Sparkles,
} from "lucide-react";
import { AiTint, aiTintKey } from "./aiTint";
import { InlineAi } from "./InlineAi";
import { useInlineAi } from "../../stores/inlineAi";
import { loadTint, pruneTint } from "../../lib/ai/aiTint";
import { openMenuAt, type MenuEntry } from "../../stores/menu";
import { commandShortcut, runCommand } from "../../lib/commands";
import { useWorkspace, type PaneId } from "../../stores/workspace";
import { registerEditorBridge, toParagraphs, type EditorBridge } from "../../lib/editorBridge";
import { editorMarkdown, splitMarkdownAt } from "../../lib/markdownOut";
import { loadDocument } from "../../lib/editorDoc";
import { askAiAboutSelection, runSelectionCommand } from "../../lib/ai/actions";
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

  const jumpText = useSearch((s) => s.jumpText);
  const outlineOpen = useOutline((s) => s.open);
  const outlineJump = useOutline((s) => s.jumpTarget);
  const typewriter = useUiNav((s) => s.typewriter);
  const toggleTypewriter = useUiNav((s) => s.toggleTypewriter);
  const focusMode = useUiNav((s) => s.focusMode);
  const aiTintOn = useUiNav((s) => s.aiTint);
  // 正文滚离顶部后顶栏才显发丝线（Zen：边界只在需要时出现）
  const [scrolled, setScrolled] = useState(false);
  const dirty = useRef<string | null>(null);
  // 编辑器里的正文属于哪一章（与 chapterId 区分：换章时新内容到达前，编辑器里仍是上一章）。
  // 自动保存与换章冲刷都按它落盘——修复「防抖窗口内切章，最后几秒的改动丢失」。
  const loadedIdRef = useRef<number | null>(null);
  // 最近一次成功落盘的内容（换章冲刷时跳过已保存的内容，避免重复写）
  const savedRef = useRef<string | null>(null);
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
  const [placeholderOpen, setPlaceholderOpen] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit, Markdown, WikiLinks, AiTint],
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
      dirty.current = editorMarkdown(ed);
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
    if (!editor || content == null) return;
    const loaded = loadedIdRef.current;
    // 同一章被重新读取（如再次点击当前章）：编辑器里已有改动时以编辑器为准，不回灌磁盘旧文
    if (loaded === chapterId && dirty.current != null) return;
    if (loaded != null && loaded !== chapterId && dirty.current != null && dirty.current !== savedRef.current) {
      const pending = dirty.current;
      void api.writeChapter(loaded, pending).catch((e) => console.warn("切章冲刷上一章失败:", e));
    }
    suppressStats.current = true;
    // 载入不进撤销栈（否则载入后很快的输入 / 采纳会与它并成一步，撤销即清空正文并被自动保存）
    loadDocument(editor, content);
    suppressStats.current = false;
    dirty.current = null;
    savedRef.current = null;
    loadedIdRef.current = chapterId;
  }, [chapterId, content, editor]);

  // AI 写入着色（阶段 2B）：换章先清空，再读该章片段表；正文里已不存在的片段顺手剪掉
  useEffect(() => {
    if (!editor || chapterId == null) return;
    let cancelled = false;
    editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { snippets: [] }));
    void loadTint(chapterId).then(async (sn) => {
      if (cancelled || editor.isDestroyed || loadedIdRef.current !== chapterId || sn.length === 0) return;
      const kept = await pruneTint(chapterId, sn, editor.state.doc.textContent);
      if (cancelled || editor.isDestroyed || loadedIdRef.current !== chapterId) return;
      editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { snippets: kept }));
    });
    return () => {
      cancelled = true;
    };
  }, [editor, chapterId, content]);
  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { on: aiTintOn }));
  }, [editor, aiTintOn]);

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

  // 编辑器桥（阶段 2A）：AI 对话读光标/选区，插入/替换/追加正文。
  // 每次写入都是单个事务（Ctrl+Z 一步撤销）；AI 写入不计入今日手写字数；显式置 dirty 交自动保存。
  useEffect(() => {
    if (!editor || chapterId == null) return;
    const markDirty = () => {
      dirty.current = editorMarkdown(editor);
    };
    const blocks = (text: string) => toParagraphs(text).map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] }));
    const write = (fn: () => boolean) => {
      suppressStats.current = true;
      try {
        const ok = fn();
        if (ok) markDirty();
        return ok;
      } finally {
        suppressStats.current = false;
      }
    };
    const docIsEmpty = () => editor.state.doc.childCount === 1 && editor.state.doc.firstChild?.content.size === 0;
    const bridge: EditorBridge = {
      chapterId,
      getContext: () => {
        const { from, to } = editor.state.selection;
        const doc = editor.state.doc;
        return {
          chapterId,
          before: doc.textBetween(0, from, "\n", " "),
          after: doc.textBetween(to, doc.content.size, "\n", " "),
          selection: from === to ? "" : doc.textBetween(from, to, "\n", " "),
          from,
          to,
        };
      },
      insertAtCursor: (text) =>
        write(() => {
          const paras = toParagraphs(text);
          if (paras.length === 0) return false;
          if (docIsEmpty()) return editor.chain().focus().insertContentAt({ from: 0, to: editor.state.doc.content.size }, blocks(text)).run();
          const $to = editor.state.selection.$to;
          // 单段：行内插入光标处
          if (paras.length === 1) return editor.chain().focus().insertContentAt(editor.state.selection.to, paras[0]).run();
          // 多段：光标在段尾/空段 → 作为新段落插在本段之后（或替换空段），不留空行
          if ($to.parent.isTextblock && $to.parentOffset === $to.parent.content.size) {
            if ($to.parent.content.size === 0) return editor.chain().focus().insertContentAt({ from: $to.before(), to: $to.after() }, blocks(text)).run();
            return editor.chain().focus().insertContentAt($to.after(), blocks(text)).run();
          }
          return editor.chain().focus().insertContentAt(editor.state.selection.to, blocks(text)).run();
        }),
      append: (text) =>
        write(() => {
          if (toParagraphs(text).length === 0) return false;
          if (docIsEmpty()) return editor.chain().insertContentAt({ from: 0, to: editor.state.doc.content.size }, blocks(text)).run();
          const ok = editor.chain().insertContentAt(editor.state.doc.content.size, blocks(text)).run();
          if (ok) editor.commands.scrollIntoView();
          return ok;
        }),
      replaceRange: (from, to, expected, text) =>
        write(() => {
          const doc = editor.state.doc;
          if (to > doc.content.size || from > to) return false;
          if (doc.textBetween(from, to, "\n", " ") !== expected) return false;
          const paras = toParagraphs(text);
          if (paras.length === 0) return false;
          const $from = doc.resolve(from);
          const $to = doc.resolve(to);
          const sameBlock = $from.sameParent($to);
          if (paras.length === 1 && sameBlock) return editor.chain().focus().insertContentAt({ from, to }, paras[0]).run();
          // 选区覆盖整段：按块边界整体替换，避免在两端留下半截空段
          const wholeFrom = $from.parent.isTextblock && $from.parentOffset === 0 ? $from.before() : from;
          const wholeTo = $to.parent.isTextblock && $to.parentOffset === $to.parent.content.size ? $to.after() : to;
          return editor.chain().focus().insertContentAt({ from: wholeFrom, to: wholeTo }, blocks(text)).run();
        }),
      // 撤销 AI 写入同样不计入今日字数（否则会被当成删掉了这么多字）
      undo: () => {
        write(() => editor.chain().focus().undo().run());
      },
      focus: () => {
        editor.commands.focus();
      },
      insertAtPoint: (x, y, text) =>
        write(() => {
          const hit = editor.view.posAtCoords({ left: x, top: y });
          if (!hit) return false;
          return editor.chain().focus().insertContentAt(hit.pos, text).run();
        }),
      insertAt: (pos, text) => {
        if (pos < 0 || pos > editor.state.doc.content.size) return false;
        editor.commands.setTextSelection(pos);
        return bridge.insertAtCursor(text);
      },
      setTint: (snippets) => {
        if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(aiTintKey, { snippets }));
      },
      restoreContent: (md) =>
        void write(() => {
          editor.commands.setContent(md);
          return true;
        }),
      splitAtCursor: () => splitMarkdownAt(editor, editor.state.selection.from),
      markdown: () => editorMarkdown(editor),
      resetContent: (md) => {
        suppressStats.current = true;
        try {
          loadDocument(editor, md);
        } finally {
          suppressStats.current = false;
        }
        dirty.current = null;
        savedRef.current = null;
      },
      flush: async () => {
        const pending = dirty.current;
        if (pending == null || pending === savedRef.current) return;
        await api.writeChapter(chapterId, pending);
        savedRef.current = pending;
        dirty.current = null;
      },
    };
    return registerEditorBridge(pane, bridge);
  }, [editor, chapterId, pane]);

  const { status } = useAutosave(
    () => dirty.current,
    async (content) => {
      const id = loadedIdRef.current;
      if (id == null) return;
      await api.writeChapter(id, content);
      if (loadedIdRef.current === id) savedRef.current = content;
    },
  );

  const currentMarkdown = () =>
    editor ? editorMarkdown(editor) : "";

  // 版本恢复：把快照文本灌进编辑器并显式置 dirty（TipTap 的 setContent 不触发 onUpdate），
  // 落盘交给上面的自动保存——与 AI 采纳路径同构。
  const restoreFromHistory = (content: string) => {
    if (!editor) return;
    suppressStats.current = true;
    editor.commands.setContent(content);
    suppressStats.current = false;
    dirty.current = editorMarkdown(editor);
  };

  const book = books.find((b) => b.id === currentBookId);
  const meta = chapters.find((c) => c.id === chapterId);

  if (chapterId == null) {
    return (
      <div
        onClick={() => useWorkspace.getState().focusPane(pane)}
        className="relative flex h-full cursor-default flex-col items-center justify-center gap-3 bg-transparent"
      >
        <PenLine size={32} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
        <div className="text-sm text-[color:var(--text-secondary)]">
          {pane === "b" ? "点击此处聚焦，再从左侧目录选一章在本窗打开" : "选择或创建一个章节开始写作"}
        </div>
        {pane === "a" && currentBookId != null && (
          <button
            onClick={() => runCommand("chapter.new")}
            className="flex items-center gap-2 rounded-[var(--r-control)] px-3 py-1.5 text-ui text-[color:var(--accent)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)]"
          >
            新建章节
            <kbd className="rounded-[4px] px-1 font-sans text-2xs text-[color:var(--text-faint)] [box-shadow:inset_0_0_0_1px_var(--hairline)]">
              {commandShortcut("chapter.new")}
            </kbd>
          </button>
        )}
      </div>
    );
  }

  const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ") ?? "";

  // 「⋯」更多：低频动作收进菜单（Zen 安静界面——次要控件不常驻）
  const moreMenu = (): MenuEntry[] => [
    {
      label: "分屏",
      icon: SquareSplitHorizontal,
      shortcut: commandShortcut("editor.cycleSplit"),
      submenu: [
        { label: "不分屏", checked: splitAxis === "none", onSelect: () => useWorkspace.getState().setSplitAxis("none") },
        { label: "左右分屏", icon: SquareSplitHorizontal, checked: splitAxis === "vertical", onSelect: () => useWorkspace.getState().setSplitAxis("vertical") },
        { label: "上下分屏", icon: SquareSplitVertical, checked: splitAxis === "horizontal", onSelect: () => useWorkspace.getState().setSplitAxis("horizontal") },
      ],
    },
    { label: "打字机滚动", icon: Type, checked: typewriter, onSelect: toggleTypewriter },
    { label: "标出 AI 写入的文字", icon: Highlighter, checked: aiTintOn, onSelect: () => useUiNav.getState().toggleAiTint() },
    { label: "悬浮大纲", icon: ListTree, checked: outlineOpen, shortcut: commandShortcut("editor.toggleOutline"), onSelect: () => useOutline.getState().toggle() },
    { label: focusMode ? "退出专注模式" : "专注模式", icon: Maximize2, shortcut: commandShortcut("view.focusMode"), onSelect: () => useUiNav.getState().toggleFocusMode() },
    { type: "separator" },
    { label: "版本历史", icon: History, checked: historyOpen, onSelect: () => setHistoryOpen((v) => !v) },
    {
      label: "检查",
      icon: ScanSearch,
      submenu: [
        { label: "敏感词检查…", onSelect: () => setSensitiveOpen(true) },
        { label: "占位符扫描…", onSelect: () => setPlaceholderOpen(true) },
      ],
    },
    { type: "separator" },
    { label: "在光标处拆分…", icon: Scissors, shortcut: commandShortcut("chapter.split"), onSelect: () => runCommand("chapter.split") },
    { label: "重命名本章", icon: Pencil, shortcut: "F2", onSelect: () => runCommand("chapter.rename") },
    { label: "移到回收站", icon: Trash2, danger: true, onSelect: () => runCommand("chapter.delete") },
  ];

  const navBtn =
    "rounded-[var(--r-control)] p-1 text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] enabled:hover:bg-[var(--fill-hover)] enabled:hover:text-[color:var(--text-primary)] disabled:opacity-30";

  return (
    <div className="relative flex h-full flex-col bg-transparent">
      {/* 顶栏 44px：面包屑 + 保存态 + 字数 + 历史前后 + 「⋯」。无描边；正文滚动后才出现发丝线。
          专注模式下平时隐去，鼠标移到顶部才浮现。 */}
      <div
        className={`group/top flex h-11 shrink-0 items-center justify-between gap-4 pl-4 pr-2 transition-[opacity,box-shadow] duration-[var(--dur-md)] ${
          scrolled ? "[box-shadow:inset_0_-1px_0_var(--hairline)]" : ""
        } ${focusMode ? "opacity-0 hover:opacity-100 focus-within:opacity-100" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate text-[color:var(--text-faint)]">{book?.title ?? ""}</span>
          <span className="shrink-0 text-[color:var(--text-faint)]">/</span>
          <span className="truncate font-medium text-[color:var(--text-primary)]">{meta?.title ?? ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-xs text-[color:var(--text-faint)]">
          <span
            className="mr-1 flex items-center gap-1.5"
            data-tip={status === "saving" ? "正在保存" : status === "saved" ? "已保存到磁盘" : "自动保存已就绪"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-[var(--dur-md)] ${
                status === "saving" ? "animate-pulse bg-[color:var(--warning)]" : status === "saved" ? "bg-[color:var(--success)]" : "bg-[var(--hairline)]"
              }`}
            />
            {status === "saving" && <span>保存中</span>}
          </span>
          <span className="mr-1 tabular-nums">{countWords(text).toLocaleString()} 字</span>
          <button
            onClick={() => void useWorkspace.getState().goBack()}
            disabled={!canBack}
            aria-label="后退"
            data-tip="后退"
            data-tip-key={commandShortcut("nav.back")}
            className={navBtn}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            onClick={() => void useWorkspace.getState().goForward()}
            disabled={!canForward}
            aria-label="前进"
            data-tip="前进"
            data-tip-key={commandShortcut("nav.forward")}
            className={navBtn}
          >
            <ArrowRight size={15} />
          </button>
          <button
            onClick={(e) => openMenuAt(e.currentTarget, moreMenu(), "end")}
            aria-label="更多"
            aria-haspopup="menu"
            data-tip="更多"
            className={`${navBtn} ${splitAxis !== "none" || typewriter || outlineOpen || historyOpen ? "text-[color:var(--accent)]" : ""}`}
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
      </div>

      {/* 正文：720px 单列衬线排版，无边框融入卡片；[[章题]] 补全浮层 fixed 定位不占版面。
          scrollerRef 供打字机滚动定位光标行。 */}
      <div
        ref={scrollerRef}
        onScroll={(e) => setScrolled((e.currentTarget as HTMLDivElement).scrollTop > 4)}
        className="flex-1 overflow-y-auto"
      >
        <EditorContent
          editor={editor}
          className={`prose-serif mx-auto max-w-[720px] px-8 ${focusMode ? "py-16" : "py-8"}`}
        />
        <WikiSuggest editor={editor} />
        {/* 选区气泡菜单（阶段 2A）：选中文字 → 一键润色/扩写/缩写/改写/描写/问 AI */}
        {editor && (
          <BubbleMenu
            editor={editor}
            tippyOptions={{ duration: 120, placement: "top", maxWidth: "none" }}
            shouldShow={({ editor: ed, from, to }) => ed.isFocused && to - from > 1 && !ed.state.selection.empty}
          >
            <div className="menu-pop flex items-center gap-0.5 rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] p-0.5 text-xs [box-shadow:var(--shadow-overlay)]" data-bubble-menu="">
              {([
                ["polish", "润色"],
                ["expand", "扩写"],
                ["condense", "缩写"],
                ["rewrite", "改写…"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void runSelectionCommand(id)}
                  className="rounded-[4px] px-2 py-1 text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
                >
                  {label}
                </button>
              ))}
              <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--hairline)]" />
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => useInlineAi.getState().open("edit", pane)}
                data-tip="就地改写，不进对话"
                data-tip-key={commandShortcut("ai.inlineEdit")}
                className="flex items-center gap-1 rounded-[4px] px-2 py-1 text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
              >
                <Sparkles size={12} />
                就地改
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => askAiAboutSelection()}
                className="rounded-[4px] px-2 py-1 font-medium text-[color:var(--accent)] transition-colors duration-[var(--dur-fast)] hover:bg-[var(--fill-hover)]"
              >
                问 AI
              </button>
            </div>
          </BubbleMenu>
        )}
        {editor && <InlineAi editor={editor} chapterId={chapterId} pane={pane} />}
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
