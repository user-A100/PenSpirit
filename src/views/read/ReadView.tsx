import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { BookOpen, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useSearch } from "../../stores/search";
import { useSettings } from "../../stores/settings";
import { useUiNav } from "../../lib/nav/uiStore";
import { kvGet, kvSet } from "../../lib/kv";
import { READING_FONT_STACKS, useReadingPrefs } from "./readingPrefs";
import { readingBgStyle } from "./readerBg";
import { useReadingPanels, type PanelPos } from "./readingPanels";
import { ReadingShell } from "./ReadingShell";

// 阅读模式：全屏只读正文（TipTap editable:false，与写作视图同源同渲染管线）。
// 排版由 readingPrefs 注入；滚动进度防抖落 KV，进入时恢复；Esc 退出回到进入前视图。

/** 阅读进度记录（KV key = `read:progress:{bookId}`） */
interface ReadProgress {
  chapter_id: number;
  scroll_ratio: number; // 0-1
  ts: number;
}

const PROGRESS_DEBOUNCE_MS = 300;
const NAV_AUTO_HIDE_MS = 1500;

// T5 顶栏消费：本次进入阅读的时刻（ReadView 每次挂载刷新）
let enteredAt = Date.now();
export function readingStartedAt(): number {
  return enteredAt;
}

/** F6/F7/F8/F9 → 左/右/上/下面板开合 */
const PANEL_HOTKEYS: Record<string, PanelPos> = {
  F6: "left",
  F7: "right",
  F8: "top",
  F9: "bottom",
};

const NAV_BTN =
  "flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white/90 " +
  "backdrop-blur-sm transition-colors duration-150 hover:bg-black/65 hover:text-white " +
  "disabled:pointer-events-none disabled:opacity-30";

export function ReadView() {
  const chapters = useWorkspace((s) => s.chapters);
  const books = useWorkspace((s) => s.books);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const chapterContent = useWorkspace((s) => s.chapterContent);
  const prefs = useReadingPrefs();
  const settingLocked = useReadingPanels((s) => s.settingLocked);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  /** 待恢复进度（章 id + 比例），消费后清空，避免后续切章误跳 */
  const restoreRef = useRef<{ chapterId: number; ratio: number } | null>(null);
  /** 编辑器已渲染的内容；进入时刻的存量内容（区分“新到内容”与“切章过渡期的旧内容”） */
  const appliedContentRef = useRef<string | null>(null);
  const entryContentRef = useRef<string | null | undefined>(undefined);
  if (entryContentRef.current === undefined) entryContentRef.current = chapterContent;
  const saveTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const bookIdRef = useRef<number | null>(null);
  bookIdRef.current = currentBookId;
  const chapterIdRef = useRef<number | null>(null);
  chapterIdRef.current = currentChapterId;
  const [navShown, setNavShown] = useState(true);
  /** 最新滚动比例 0-1（TopPanel 百分比轮询；ref 旁路避免滚动路径重渲染） */
  const progressRef = useRef(0);
  /** 滚到底 → 章末「下一章」提示 */
  const [atBottom, setAtBottom] = useState(false);

  // 惰性初始化即写入模块变量（挂载即“本次阅读”起点）
  const [startedAt] = useState(() => {
    enteredAt = Date.now();
    return enteredAt;
  });

  // ---- 退出：回到进入前视图（App 在切进 read 时记录；无记录回 write） ----
  const exitRead = useCallback(() => {
    const { readReturn, setView } = useUiNav.getState();
    setView(readReturn ?? "write");
  }, []);

  // ---- 只读 TipTap（StarterKit+Markdown，与 ChapterEditor 同渲染管线） ----
  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    editable: false,
    immediatelyRender: false,
  });

  /** 恢复到记录比例（一次性，消费后清标志） */
  const applyRestore = useCallback(() => {
    const r = restoreRef.current;
    restoreRef.current = null;
    const el = scrollRef.current;
    if (!el || !r) return;
    const denom = el.scrollHeight - el.clientHeight;
    el.scrollTop = denom > 0 ? r.ratio * denom : 0;
  }, []);

  // 灌内容 + 滚动定位（先于定位声明，同一次提交里内容先落 DOM）
  useEffect(() => {
    if (!editor || chapterContent == null) return;
    editor.commands.setContent(chapterContent);
    const isNew = appliedContentRef.current !== chapterContent;
    appliedContentRef.current = chapterContent;
    if (!isNew) return;
    const r = restoreRef.current;
    if (r && r.chapterId === currentChapterId && chapterContent !== entryContentRef.current) {
      applyRestore();
    } else if (!r) {
      // 换章/首帧回顶
      const el = scrollRef.current;
      if (el) el.scrollTop = 0;
    }
  }, [currentChapterId, chapterContent, editor, applyRestore]);

  // 章末提示基准：内容就位后重算（短章无滚动条时 onScroll 不会触发）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const denom = el.scrollHeight - el.clientHeight;
    if (denom <= 0) {
      progressRef.current = 1;
      setAtBottom(true);
    } else {
      setAtBottom(el.scrollTop / denom >= 0.995);
    }
  }, [currentChapterId, chapterContent]);

  // 进入时恢复上次进度：有记录且章存在 → 切到该章，内容就位后回到比例位置
  useEffect(() => {
    if (currentBookId == null) return;
    let dead = false;
    void kvGet<ReadProgress>(`read:progress:${currentBookId}`)
      .then((rec) => {
        if (dead || rec == null) return;
        if (typeof rec.chapter_id !== "number" || !Number.isFinite(rec.chapter_id)) return;
        if (typeof rec.scroll_ratio !== "number" || !Number.isFinite(rec.scroll_ratio)) return;
        const ws = useWorkspace.getState();
        if (!ws.chapters.some((c) => c.id === rec.chapter_id)) return;
        restoreRef.current = {
          chapterId: rec.chapter_id,
          ratio: Math.min(1, Math.max(0, rec.scroll_ratio)),
        };
        if (ws.currentChapterId !== rec.chapter_id) void ws.selectChapter(rec.chapter_id);
        else if (appliedContentRef.current === ws.chapterContent) applyRestore();
        // 其余情形（该章内容在途）：由上面的内容 effect 消费
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [currentBookId, applyRestore]);

  // ---- 进度记忆：滚动 300ms 防抖落 KV；比例同步进 ref / 章末态 ----
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      const denom = el.scrollHeight - el.clientHeight;
      const ratio = denom > 0 ? Math.min(1, Math.max(0, el.scrollTop / denom)) : 1;
      progressRef.current = ratio;
      setAtBottom(ratio >= 0.995); // 同值 setState 由 React bail，不额外渲染
    }
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const bookId = bookIdRef.current;
      const chapterId = chapterIdRef.current;
      const el = scrollRef.current;
      if (bookId == null || chapterId == null || el == null) return;
      const denom = el.scrollHeight - el.clientHeight;
      const ratio = denom > 0 ? Math.min(1, Math.max(0, el.scrollTop / denom)) : 0;
      void kvSet(`read:progress:${bookId}`, {
        chapter_id: chapterId,
        scroll_ratio: ratio,
        ts: Date.now(),
      }).catch(() => {});
    }, PROGRESS_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(saveTimer.current), []);

  // ---- 章导航：chapters 数组序 prev/next（Ctrl+←/→ 与悬浮钮共用） ----
  const idx = chapters.findIndex((c) => c.id === currentChapterId);
  const prevChapter = idx > 0 ? chapters[idx - 1] : null;
  const nextChapter = idx >= 0 && idx + 1 < chapters.length ? chapters[idx + 1] : null;

  // ---- 键盘：Esc 退出 / Ctrl+←→ 换章 / F6-9 面板开合；↑↓/PageUp/Down 走容器原生滚动 ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 设置/搜索弹层开着时让给它处理
      if (useSettings.getState().modalOpen || useSearch.getState().open) return;
      const panelKey = PANEL_HOTKEYS[e.key];
      if (panelKey) {
        e.preventDefault();
        useReadingPanels.getState().toggle(panelKey);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        exitRead();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const ws = useWorkspace.getState();
      const i = ws.chapters.findIndex((c) => c.id === ws.currentChapterId);
      const target =
        e.key === "ArrowLeft"
          ? i > 0
            ? ws.chapters[i - 1]
            : null
          : i >= 0 && i + 1 < ws.chapters.length
            ? ws.chapters[i + 1]
            : null;
      if (!target) return;
      e.preventDefault();
      void ws.selectChapter(target.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitRead]);

  // ---- 悬浮圆钮：进入显示 1.5s 后淡出，鼠标进入恢复、离开再计时 ----
  const armHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setNavShown(false), NAV_AUTO_HIDE_MS);
  }, []);
  useEffect(() => {
    armHide();
    return () => window.clearTimeout(hideTimer.current);
  }, [armHide]);

  // 键盘滚动需要容器持有焦点（tabIndex + 自动聚焦；每章切换后重新聚焦）
  useEffect(() => {
    if (currentChapterId != null) scrollRef.current?.focus();
  }, [currentChapterId]);

  // ---- 空态：无当前章 ----
  if (currentChapterId == null) {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-3"
        style={{ backgroundColor: prefs.bgColor, color: prefs.textColor }}
      >
        <BookOpen size={32} strokeWidth={1.5} className="opacity-40" />
        <div className="text-sm opacity-80">在写作视图选择章节后进入阅读</div>
        <button
          onClick={exitRead}
          className="rounded-md border border-current/30 px-3 py-1.5 text-xs opacity-80 transition-opacity duration-150 hover:opacity-100"
        >
          返回继续写作（Esc）
        </button>
      </div>
    );
  }

  const fontStack = READING_FONT_STACKS[prefs.fontFamily];
  const gotoChapter = (id: number) => {
    if (id !== chapterIdRef.current) void useWorkspace.getState().selectChapter(id);
  };
  const bookTitle = books.find((b) => b.id === currentBookId)?.title ?? "未命名书";
  const chapterTitle = idx >= 0 ? chapters[idx].title : "";

  return (
    <div className="relative h-full w-full overflow-hidden" style={readingBgStyle(prefs)}>
      <ReadingShell
        bookTitle={bookTitle}
        chapterTitle={chapterTitle}
        startedAt={startedAt}
        progressRef={progressRef}
        chapters={chapters}
        currentChapterId={currentChapterId}
        onSelectChapter={gotoChapter}
        onExit={exitRead}
        onPrevChapter={() => prevChapter && gotoChapter(prevChapter.id)}
        onNextChapter={() => nextChapter && gotoChapter(nextChapter.id)}
        prevDisabled={!prevChapter}
        nextDisabled={!nextChapter}
      >
        <div
          ref={scrollRef}
          tabIndex={0}
          onScroll={onScroll}
          className="h-full w-full overflow-y-auto outline-none"
          style={{ paddingLeft: prefs.margin, paddingRight: prefs.margin }}
        >
          <div
            className={`prose-serif mx-auto w-full px-8 py-10 ${
              // 强制覆盖 html[data-prose-indent]（写作视图的全局缩进设置），阅读态自成一体
              prefs.indent ? "[&_p]:[text-indent:2em]!" : "[&_p]:[text-indent:0em]!"
            }`}
            style={{
              maxWidth: prefs.pageWidth,
              fontSize: prefs.fontSize,
              lineHeight: prefs.lineHeight,
              letterSpacing: `${prefs.letterSpacing}em`,
              textAlign: prefs.textAlign,
              color: prefs.textColor,
              ...(fontStack ? { fontFamily: fontStack } : null),
              ...({ "--prose-para-spacing": `${prefs.paraSpacing}em` } as unknown as CSSProperties),
            }}
          >
            <EditorContent editor={editor} />
            {/* 章末提示：滚到底出现（books scrollChapter 语义） */}
            {atBottom &&
              (nextChapter ? (
                <button
                  onClick={() => gotoChapter(nextChapter.id)}
                  className="mx-auto mt-10 mb-2 flex max-w-full items-center gap-1.5 rounded-full border border-current/30 px-5 py-2 text-sm opacity-70 transition-opacity duration-300 hover:opacity-100"
                >
                  <span className="truncate">下一章：{nextChapter.title}</span>
                  <span aria-hidden>→</span>
                </button>
              ) : (
                <div className="mt-10 mb-2 text-center text-xs opacity-40">已是最后一章</div>
              ))}
          </div>
        </div>
      </ReadingShell>

      {/* 右下角悬浮圆钮：上一章 / 下一章 / 退出（右侧锁定时让位） */}
      <div
        onMouseEnter={() => {
          window.clearTimeout(hideTimer.current);
          setNavShown(true);
        }}
        onMouseLeave={armHide}
        className={`fixed bottom-6 z-10 flex flex-col gap-2 ${
          navShown ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        style={{
          right: settingLocked ? "calc(var(--read-panel-w) + 24px)" : 24,
          transition: "opacity 0.5s ease, right 0.5s ease",
        }}
      >
        <button
          onClick={() => prevChapter && gotoChapter(prevChapter.id)}
          disabled={!prevChapter}
          title="上一章（Ctrl+←）"
          className={NAV_BTN}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={() => nextChapter && gotoChapter(nextChapter.id)}
          disabled={!nextChapter}
          title="下一章（Ctrl+→）"
          className={NAV_BTN}
        >
          <ChevronRight size={16} />
        </button>
        <button onClick={exitRead} title="退出阅读（Esc）" className={NAV_BTN}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
