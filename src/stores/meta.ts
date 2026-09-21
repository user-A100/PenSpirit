import { create } from "zustand";
import { api, Keyword, Label, Status, ChapterMetaUpdate } from "../lib/tauri";
import { useWorkspace } from "./workspace";

interface MetaState {
  labels: Label[];
  statuses: Status[];
  keywords: Keyword[];
  /** 当前章已挂的关键词 */
  chapterKeywords: Keyword[];
  loadDefinitions: (bookId: number) => Promise<void>;
  loadChapterKeywords: (chapterId: number) => Promise<void>;
  /** 部分更新当前章元数据，并原地替换 workspace.chapters 里的该条 */
  updateChapterMeta: (update: ChapterMetaUpdate) => Promise<void>;
  /** 已挂则摘除，未挂则挂上（replace-all 语义由后端保证） */
  toggleChapterKeyword: (keywordId: number) => Promise<void>;
  createKeyword: (title: string) => Promise<Keyword | null>;
  deleteKeyword: (id: number) => Promise<void>;
  labelUpsert: (input: { id: number | null; book_id: number; title: string; color: string }) => Promise<void>;
  labelDelete: (id: number) => Promise<void>;
  statusUpsert: (input: { id: number | null; book_id: number; title: string }) => Promise<void>;
  statusDelete: (id: number) => Promise<void>;
}

export const useMeta = create<MetaState>((set, get) => ({
  labels: [], statuses: [], keywords: [], chapterKeywords: [],
  loadDefinitions: async (bookId) => {
    const [labels, statuses, keywords] = await Promise.all([
      api.labelsList(bookId),
      api.statusesList(bookId),
      api.keywordsList(bookId),
    ]);
    // 过期响应丢弃：快速连切两书时，慢的那份不能覆盖新书的定义
    if (useWorkspace.getState().currentBookId !== bookId) return;
    set({ labels, statuses, keywords });
  },
  loadChapterKeywords: async (chapterId) => {
    const kws = await api.keywordsForChapter(chapterId);
    if (useWorkspace.getState().currentChapterId !== chapterId) return;
    set({ chapterKeywords: kws });
  },
  updateChapterMeta: async (update) => {
    const chapterId = useWorkspace.getState().currentChapterId;
    if (chapterId == null) return;
    const meta = await api.chapterUpdateMeta(chapterId, update);
    useWorkspace.setState((s) => ({
      chapters: s.chapters.map((c) => (c.id === meta.id ? meta : c)),
    }));
  },
  toggleChapterKeyword: async (keywordId) => {
    const chapterId = useWorkspace.getState().currentChapterId;
    if (chapterId == null) return;
    const current = get().chapterKeywords;
    const nextIds = current.some((k) => k.id === keywordId)
      ? current.filter((k) => k.id !== keywordId).map((k) => k.id)
      : [...current.map((k) => k.id), keywordId];
    set({ chapterKeywords: await api.chapterSetKeywords(chapterId, nextIds) });
  },
  createKeyword: async (title) => {
    const bookId = useWorkspace.getState().currentBookId;
    if (bookId == null) return null;
    const kw = await api.keywordCreate(bookId, title);
    set((s) => ({ keywords: [...s.keywords, kw] }));
    return kw;
  },
  deleteKeyword: async (id) => {
    await api.keywordDelete(id);
    set((s) => ({
      keywords: s.keywords.filter((k) => k.id !== id),
      chapterKeywords: s.chapterKeywords.filter((k) => k.id !== id),
    }));
  },
  labelUpsert: async (input) => {
    const saved = await api.labelUpsert(input);
    set((s) => {
      const exists = s.labels.some((l) => l.id === saved.id);
      return {
        labels: exists
          ? s.labels.map((l) => (l.id === saved.id ? saved : l))
          : [...s.labels, saved],
      };
    });
  },
  labelDelete: async (id) => {
    await api.labelDelete(id);
    set((s) => ({ labels: s.labels.filter((l) => l.id !== id) }));
  },
  statusUpsert: async (input) => {
    const saved = await api.statusUpsert(input);
    set((s) => {
      const exists = s.statuses.some((st) => st.id === saved.id);
      return {
        statuses: exists
          ? s.statuses.map((st) => (st.id === saved.id ? saved : st))
          : [...s.statuses, saved],
      };
    });
  },
  statusDelete: async (id) => {
    await api.statusDelete(id);
    set((s) => ({ statuses: s.statuses.filter((st) => st.id !== id) }));
  },
}));

// 书/章切换自动拉取：侧栏色点、dock 面板、卡片墙（批次2）都不必各自挂 effect
useWorkspace.subscribe((s, prev) => {
  if (s.currentBookId !== prev.currentBookId && s.currentBookId != null) {
    void useMeta.getState().loadDefinitions(s.currentBookId).catch(console.warn);
  }
  if (s.currentChapterId !== prev.currentChapterId) {
    if (s.currentChapterId == null) {
      useMeta.setState({ chapterKeywords: [] });
    } else {
      void useMeta.getState().loadChapterKeywords(s.currentChapterId).catch(console.warn);
    }
  }
});
