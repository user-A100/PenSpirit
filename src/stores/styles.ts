import { create } from "zustand";
import { api, StyleCard } from "../lib/tauri";
import { useWorkspace } from "./workspace";

/**
 * activeStyleId 用 0 表示「无文风」：后端 settings 存 `style:book:{id} = 0`，
 * 组装器按 id 在 styles 中查不到卡 → 不注入 system 槽（styles.id 自增从 1 起，0 永不命中）。
 */

/** StyleCard.tags 在库里是 JSON 数组字符串（`["仙侠","冷峻"]`），表单里编辑为逗号分隔文本。 */
export function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)).filter((x) => x.trim()) : [];
  } catch {
    return [];
  }
}

/** 中英文逗号皆可作分隔；空段丢弃。 */
export function toTagsJson(text: string): string {
  return JSON.stringify(text.split(/[,，]/).map((t) => t.trim()).filter(Boolean));
}

interface StylesState {
  styles: StyleCard[];
  activeStyleId: number;
  editingId: number | null;
  error: string | null;
  load: () => Promise<void>;
  save: (id: number, name: string, promptMd: string, sampleMd: string, tags: string) => Promise<StyleCard>;
  remove: (id: number) => Promise<void>;
  activate: (styleId: number) => Promise<void>;
  setEditing: (id: number | null) => void;
}

export const useStyles = create<StylesState>((set, get) => ({
  styles: [],
  activeStyleId: 0,
  editingId: null,
  error: null,
  load: async () => {
    try {
      const styles = await api.listStyles();
      const bookId = useWorkspace.getState().currentBookId;
      // 激活位按书记录；无当前书视为无文风
      const raw = bookId == null ? 0 : (await api.getActiveStyle(bookId)) ?? 0;
      // 归一：激活指向已删除的文风卡时按「无文风」展示（组装器同样取不到，行为一致）
      set({ styles, activeStyleId: styles.some((s) => s.id === raw) ? raw : 0, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },
  save: async (id, name, promptMd, sampleMd, tags) => {
    const saved = await api.saveStyle(id, name, promptMd, sampleMd, tags);
    set({ editingId: saved.id });
    await get().load();
    return saved;
  },
  remove: async (id) => {
    await api.deleteStyle(id);
    if (get().editingId === id) set({ editingId: null });
    await get().load();
  },
  activate: async (styleId) => {
    const bookId = useWorkspace.getState().currentBookId;
    if (bookId == null) return; // 无当前书：激活位无处可记
    await api.setActiveStyle(bookId, styleId);
    set({ activeStyleId: styleId });
    await get().load();
  },
  setEditing: (id) => set({ editingId: id }),
}));
