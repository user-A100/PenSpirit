import { create } from "zustand";
import { api, type SearchHit } from "../lib/tauri";
import { useWorkspace } from "./workspace";

// M2-T9 全书搜索状态。防抖在 SearchPanel 里做，这里只负责一次实际查询。
// 跳转分两步：先 selectChapter（异步读正文进编辑器），再把待定位文本交给
// 编辑器消费（jumpText）——编辑器是否已加载完由它自己的 effect 依赖保证。

interface SearchState {
  open: boolean;
  query: string;
  wholeWord: boolean;
  /** 搜索范围："all" 全部 / "title" 仅标题 / "content" 仅正文 */
  scope: string;
  hits: SearchHit[];
  /** 命中数触顶被截断（Rust 侧 MAX_HITS） */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  /** 待编辑器定位的文本；编辑器消费后调用 clearJump */
  jumpText: string | null;
  openPanel: () => void;
  closePanel: () => void;
  setQuery: (q: string) => void;
  setWholeWord: (v: boolean) => void;
  setScope: (v: string) => void;
  search: (bookId: number | null) => Promise<void>;
  jump: (hit: SearchHit) => Promise<void>;
  clearJump: () => void;
}

export const useSearch = create<SearchState>((set, get) => ({
  open: false,
  query: "",
  wholeWord: false,
  scope: "all",
  hits: [],
  truncated: false,
  loading: false,
  error: null,
  jumpText: null,

  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  setQuery: (query) => set({ query }),
  setWholeWord: (wholeWord) => set({ wholeWord }),
  setScope: (scope) => set({ scope }),

  search: async (bookId) => {
    const { query, wholeWord, scope } = get();
    if (bookId == null || query.trim() === "") {
      set({ hits: [], truncated: false, loading: false, error: null });
      return;
    }
    set({ loading: true });
    try {
      const r = await api.searchBook(bookId, query, wholeWord, scope);
      set({ hits: r.hits, truncated: r.truncated, loading: false, error: null });
    } catch (e) {
      set({ hits: [], truncated: false, loading: false, error: String(e) });
    }
  },

  jump: async (hit) => {
    await useWorkspace.getState().selectChapter(hit.chapter_id);
    set({ jumpText: hit.line_text.trim() || null, open: false });
  },

  clearJump: () => set({ jumpText: null }),
}));
