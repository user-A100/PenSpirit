import { create } from "zustand";
import { api, Book, ChapterMeta } from "../lib/tauri";

interface WorkspaceState {
  books: Book[]; chapters: ChapterMeta[];
  currentBookId: number | null; currentChapterId: number | null;
  chapterContent: string | null;
  loading: boolean; error: string | null;
  loadBooks: () => Promise<void>;
  selectBook: (id: number) => Promise<void>;
  createBook: (title: string) => Promise<void>;
  createChapter: (title: string) => Promise<void>;
  selectChapter: (id: number) => Promise<void>;
  /** 乐观重排当前书章节（侧栏/卡片墙拖拽），失败回滚重拉 */
  reorderChapters: (ids: number[]) => Promise<void>;
  /** 重取当前书章节列表（不动选中章），回收站恢复后刷新用 */
  reloadChapters: () => Promise<void>;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null, loading: false, error: null,
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
    set({ currentBookId: id, currentChapterId: null });
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
    set({ currentChapterId: id });
    const full = await api.readChapter(id);
    set({ chapterContent: full.content });
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
}));
