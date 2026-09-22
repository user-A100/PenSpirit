import { create } from "zustand";
import { api, Book, ChapterMeta } from "../lib/tauri";

// M7 批次5：双编辑器分屏。pane a 是主编辑位（分屏关闭时的唯一编辑器），
// pane b 随分屏开启出现（初始为空，点进 b 窗格后从目录选章）。
// currentChapterId/chapterContent 始终镜像「活动窗格」——侧栏高亮、右侧 dock
// 面板、AI 会话因此天然跟随当前焦点窗格（Scrivener inspector 的跟随行为）。

export type SplitAxis = "none" | "vertical" | "horizontal";
export type PaneId = "a" | "b";

export interface PaneSlot {
  chapterId: number | null;
  content: string | null;
}

const EMPTY_PANE: PaneSlot = { chapterId: null, content: null };
const HISTORY_MAX = 100;

interface WorkspaceState {
  books: Book[]; chapters: ChapterMeta[];
  currentBookId: number | null; currentChapterId: number | null;
  chapterContent: string | null;
  loading: boolean; error: string | null;
  /** 分屏方向：vertical=左右并排，horizontal=上下堆叠 */
  splitAxis: SplitAxis;
  panes: Record<PaneId, PaneSlot>;
  /** 活动窗格：目录点选与历史导航都写进它 */
  activePane: PaneId;
  /** 章节导航历史（浏览器式后退/前进；selectChapter 压栈，back/forward 不压栈） */
  history: number[];
  historyIndex: number;
  loadBooks: () => Promise<void>;
  selectBook: (id: number) => Promise<void>;
  createBook: (title: string) => Promise<void>;
  createChapter: (title: string) => Promise<void>;
  selectChapter: (id: number) => Promise<void>;
  setSplitAxis: (axis: SplitAxis) => void;
  cycleSplit: () => void;
  focusPane: (p: PaneId) => void;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  /** 乐观重排当前书章节（侧栏/卡片墙拖拽），失败回滚重拉 */
  reorderChapters: (ids: number[]) => Promise<void>;
  /** 重取当前书章节列表（不动选中章），回收站恢复后刷新用 */
  reloadChapters: () => Promise<void>;
}

/** 压入导航历史：截掉前进分支、连续重复不压、超上限丢最旧 */
function pushHistory(st: { history: number[]; historyIndex: number }, id: number) {
  const h = st.history.slice(0, st.historyIndex + 1);
  if (h[h.length - 1] === id) return {};
  h.push(id);
  const trimmed = h.length > HISTORY_MAX ? h.slice(h.length - HISTORY_MAX) : h;
  return { history: trimmed, historyIndex: trimmed.length - 1 };
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  // 把章读进活动窗格并同步镜像（历史压栈与否由调用方决定，这里只管装载）
  const loadIntoActive = async (id: number) => {
    const pane = get().activePane;
    set((st) => ({ currentChapterId: id, panes: { ...st.panes, [pane]: { ...st.panes[pane], chapterId: id } } }));
    const full = await api.readChapter(id);
    set((st) => ({
      chapterContent: st.activePane === pane ? full.content : st.chapterContent,
      panes: { ...st.panes, [pane]: { ...st.panes[pane], content: full.content } },
    }));
  };

  return {
    books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null, loading: false, error: null,
    splitAxis: "none",
    panes: { a: { ...EMPTY_PANE }, b: { ...EMPTY_PANE } },
    activePane: "a",
    history: [],
    historyIndex: -1,

    loadBooks: async () => {
      set({ loading: true, error: null });
      try {
        const books = await api.listBooks();
        set({ books, loading: false });
        // 冷启动自动恢复上次的书（localStorage 记忆；书没了/首次启动退到第一本）。
        // 没有这一步，伏笔/人物卡等面板会停在「请先选择书籍」、登记按钮永远灰着，
        // 用户视角即「功能不能用」。
        if (get().currentBookId == null && books.length > 0) {
          const last = Number(localStorage.getItem("bixian.lastBookId"));
          const restore = books.find((b) => b.id === last) ?? books[0];
          await get().selectBook(restore.id);
        }
      } catch (e) { set({ error: String(e), loading: false }); }
    },
    selectBook: async (id) => {
      localStorage.setItem("bixian.lastBookId", String(id));
      // 换书收分屏、清历史：跨书的 pane 内容与回退没有意义
      set({
        currentBookId: id, currentChapterId: null, chapterContent: null,
        splitAxis: "none", panes: { a: { ...EMPTY_PANE }, b: { ...EMPTY_PANE } },
        activePane: "a", history: [], historyIndex: -1,
      });
      set({ chapters: await api.listChapters(id) });
    },
    createBook: async (title) => {
      const book = await api.createBook(title);
      await get().loadBooks();
      await get().selectBook(book.id);
    },
    createChapter: async (title) => {
      const bookId = get().currentBookId;
      if (bookId == null) return;
      await api.createChapter(bookId, title);
      set({ chapters: await api.listChapters(bookId) });
    },
    selectChapter: async (id) => {
      set((st) => pushHistory(st, id));
      await loadIntoActive(id);
    },
    setSplitAxis: (axis) => {
      if (axis === "none") {
        // 收分屏：焦点归位 a（b 槽位保留，再次分屏时接着用）
        set((st) => ({
          splitAxis: "none",
          activePane: "a",
          currentChapterId: st.panes.a.chapterId,
          chapterContent: st.panes.a.content,
        }));
        return;
      }
      set({ splitAxis: axis });
    },
    cycleSplit: () => {
      const order: SplitAxis[] = ["none", "vertical", "horizontal"];
      const next = order[(order.indexOf(get().splitAxis) + 1) % order.length];
      get().setSplitAxis(next);
    },
    focusPane: (p) =>
      set((st) =>
        st.activePane === p
          ? {}
          : {
              activePane: p,
              currentChapterId: st.panes[p].chapterId,
              chapterContent: st.panes[p].content,
            },
      ),
    goBack: async () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ historyIndex: historyIndex - 1 });
      await loadIntoActive(history[historyIndex - 1]);
    },
    goForward: async () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ historyIndex: historyIndex + 1 });
      await loadIntoActive(history[historyIndex + 1]);
    },
    reorderChapters: async (ids) => {
      const bookId = get().currentBookId;
      if (bookId == null) return;
      const prev = get().chapters;
      const pos = new Map(ids.map((id, i) => [id, i]));
      set({ chapters: [...prev].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)) });
      try {
        await api.reorderChapters(ids);
      } catch (e) {
        set({ chapters: prev, error: String(e) });
      }
    },
    reloadChapters: async () => {
      const bookId = get().currentBookId;
      if (bookId == null) return;
      set({ chapters: await api.listChapters(bookId) });
    },
  };
});
