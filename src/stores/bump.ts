import { create } from "zustand";
import { api, type BumpWord, type Idea } from "../lib/tauri";

// M2-T10 碰碰车状态。碰撞结果只存内存（drawn）——想留下就「存为灵感卡」，
// 这样词库/灵感卡两组数据各自独立，不会因为随手碰撞而堆积垃圾。

/** 标签输入按空格/逗号/顿号切分（中英文标点都认） */
export function parseTags(input: string): string[] {
  return input
    .split(/[\s,，、]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** 解析后端返回的 JSON 数组字符串；坏数据退化为空数组而非抛错 */
export function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface BumpState {
  words: BumpWord[];
  ideas: Idea[];
  /** 本次碰撞结果 */
  drawn: string[];
  /** 抽取数量（2-4） */
  count: number;
  note: string;
  tags: string;
  busy: boolean;
  error: string | null;
  load: () => Promise<void>;
  addWord: (word: string) => Promise<void>;
  removeWord: (id: number) => Promise<void>;
  clearWords: () => Promise<void>;
  draw: () => Promise<void>;
  saveIdea: () => Promise<void>;
  removeIdea: (id: number) => Promise<void>;
  setCount: (n: number) => void;
  setNote: (v: string) => void;
  setTags: (v: string) => void;
}

export const useBump = create<BumpState>((set, get) => ({
  words: [],
  ideas: [],
  drawn: [],
  count: 3,
  note: "",
  tags: "",
  busy: false,
  error: null,

  load: async () => {
    try {
      const [words, ideas] = await Promise.all([api.bumpListWords(), api.ideasList()]);
      set({ words, ideas, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  addWord: async (word) => {
    try {
      await api.bumpAddWord(word);
      set({ words: await api.bumpListWords(), error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeWord: async (id) => {
    try {
      await api.bumpDeleteWord(id);
      set({ words: await api.bumpListWords(), error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  clearWords: async () => {
    try {
      await api.bumpClearWords();
      set({ words: [], drawn: [], error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  draw: async () => {
    set({ busy: true });
    try {
      set({ drawn: await api.bumpDraw(get().count), error: null });
    } catch (e) {
      set({ drawn: [], error: String(e) });
    } finally {
      set({ busy: false });
    }
  },

  saveIdea: async () => {
    const { drawn, note, tags } = get();
    if (drawn.length === 0) return;
    try {
      await api.ideasCreate(note, JSON.stringify(drawn), JSON.stringify(parseTags(tags)));
      set({ ideas: await api.ideasList(), note: "", tags: "", error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  removeIdea: async (id) => {
    try {
      await api.ideasDelete(id);
      set({ ideas: await api.ideasList(), error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  setCount: (count) => set({ count }),
  setNote: (note) => set({ note }),
  setTags: (tags) => set({ tags }),
}));
