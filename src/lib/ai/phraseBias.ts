import { create } from "zustand";
import { api, type PhraseBias } from "../tauri";

// 词语偏置（阶段 2C）：本书适用的禁用 / 偏好表达（通用 + 本书）。生成时由后端注入；
// 前端用禁用表给回答查「AI 腔」，并提供「去掉重写」。

interface PhraseBiasState {
  bookId: number | null;
  list: PhraseBias[];
  load: (bookId: number | null) => Promise<void>;
}

export const usePhraseBias = create<PhraseBiasState>((set, get) => ({
  bookId: null,
  list: [],
  load: async (bookId) => {
    set({ bookId });
    try {
      const list = await api.phraseBiasList(bookId);
      if (get().bookId === bookId) set({ list });
    } catch {
      if (get().bookId === bookId) set({ list: [] });
    }
  },
}));

/** 文本里出现的禁用表达（去重、按表序） */
export function banHits(text: string, list: PhraseBias[]): string[] {
  return [...new Set(list.filter((p) => p.kind === "ban" && p.phrase && text.includes(p.phrase)).map((p) => p.phrase))];
}
