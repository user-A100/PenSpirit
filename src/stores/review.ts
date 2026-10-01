import { create } from "zustand";

// 替换前差异预览（阶段 2A）：Promise 化，接受 → true。
export interface ReviewRequest {
  title: string;
  before: string;
  after: string;
  resolve: (ok: boolean) => void;
}

export const useReview = create<{ req: ReviewRequest | null; answer: (ok: boolean) => void }>((set, get) => ({
  req: null,
  answer: (ok) => {
    const r = get().req;
    set({ req: null });
    r?.resolve(ok);
  },
}));

export function reviewDiff(title: string, before: string, after: string): Promise<boolean> {
  return new Promise((resolve) => {
    useReview.getState().req?.resolve(false);
    useReview.setState({ req: { title, before, after, resolve } });
  });
}
