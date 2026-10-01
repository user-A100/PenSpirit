import { create } from "zustand";

// Promise 化确认框：替代 window.confirm（WebView2 里会弹 Windows 系统框）。
// 用法：if (!(await confirmDialog({ title: "删除…？", danger: true }))) return;

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 危险操作：确认按钮红色 */
  danger?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  queue: ConfirmRequest[];
  answer: (id: number, ok: boolean) => void;
}

let seq = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  answer: (id, ok) => {
    const req = get().queue.find((r) => r.id === id);
    set((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
    req?.resolve(ok);
  },
}));

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++seq;
    useConfirmStore.setState((s) => ({ queue: [...s.queue, { ...opts, id, resolve }] }));
  });
}
