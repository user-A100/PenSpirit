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
  /** 重取当前书章节列表（不动选中章），回收站恢复后刷新用 */
  reloadChapters: () => Promise<void>;
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null, loading: false, error: null,
  loadBooks: async () => {
    set({ loading: true, error: null });
    try { set({ books: await api.listBooks(), loading: false }); }
    catch (e) { set({ error: String(e), loading: false }); }
  },
  selectBook: async (id) => {
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
  reloadChapters: async () => {
    const bookId = get().currentBookId;
    if (bookId == null) return;
    set({ chapters: await api.listChapters(bookId) });
  },
}));
