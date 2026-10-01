import { create } from "zustand";

// 替换前差异预览（阶段 2A）：Promise 化。阶段 2B：逐段取舍——
// 返回按取舍拼好的最终文本（全部采用 = after 原样），取消 → null。
export interface ReviewRequest {
  title: string;
  before: string;
  after: string;
  resolve: (text: string | null) => void;
}

export const useReview = create<{ req: ReviewRequest | null; answer: (text: string | null) => void }>((set, get) => ({
  req: null,
  answer: (text) => {
    const r = get().req;
    set({ req: null });
    r?.resolve(text);
  },
}));

export function reviewDiff(title: string, before: string, after: string): Promise<string | null> {
  return new Promise((resolve) => {
    useReview.getState().req?.resolve(null);
    useReview.setState({ req: { title, before, after, resolve } });
  });
}
