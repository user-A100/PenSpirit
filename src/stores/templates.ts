import { create } from "zustand";
import { api, ChapterTemplate, ChapterTemplateInput } from "../lib/tauri";
import { useWorkspace } from "./workspace";

interface TemplatesState {
  list: ChapterTemplate[];
  load: (bookId: number) => Promise<void>;
  upsert: (input: ChapterTemplateInput) => Promise<ChapterTemplate | null>;
  remove: (id: number) => Promise<void>;
  setDefault: (id: number, isDefault: boolean) => Promise<void>;
}

export const useTemplates = create<TemplatesState>((set) => ({
  list: [],
  load: async (bookId) => {
    set({ list: await api.templatesList(bookId) });
  },
  upsert: async (input) => {
    const saved = await api.templateUpsert(input);
    set((s) => {
      const exists = s.list.some((t) => t.id === saved.id);
      // 默认位独占由后端保证；本地同步把别的默认旗子放下来
      const list = exists
        ? s.list.map((t) => (t.id === saved.id ? saved : saved.is_default ? { ...t, is_default: false } : t))
        : saved.is_default
          ? [...s.list.map((t) => ({ ...t, is_default: false })), saved]
          : [...s.list, saved];
      return { list };
    });
    return saved;
  },
  remove: async (id) => {
    await api.templateDelete(id);
    set((s) => ({ list: s.list.filter((t) => t.id !== id) }));
  },
  setDefault: async (id, isDefault) => {
    const saved = await api.templateSetDefault(id, isDefault);
    set((s) => ({
      list: s.list.map((t) =>
        t.id === saved.id ? saved : saved.is_default ? { ...t, is_default: false } : t,
      ),
    }));
  },
}));

// 视图挂载前也无感可用：跟 meta 同款，书切换自动拉模板列表
useWorkspace.subscribe((s, prev) => {
  if (s.currentBookId !== prev.currentBookId && s.currentBookId != null) {
    void useTemplates.getState().load(s.currentBookId).catch(console.warn);
  }
});
