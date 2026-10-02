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
  /** 输入框模式（promptDialog）：初值与占位符；确认时把输入文本交给 resolveText */
  input?: { initial: string; placeholder?: string };
  resolve: (ok: boolean) => void;
  resolveText?: (text: string | null) => void;
}

interface ConfirmState {
  queue: ConfirmRequest[];
  answer: (id: number, ok: boolean, text?: string) => void;
}

let seq = 0;

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  queue: [],
  answer: (id, ok, text) => {
    const req = get().queue.find((r) => r.id === id);
    set((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
    req?.resolve(ok);
    req?.resolveText?.(ok ? (text ?? "") : null);
  },
}));

export interface PromptOptions extends Omit<ConfirmOptions, "danger"> {
  initial?: string;
  placeholder?: string;
}

/** 输入框确认：确认返回输入文本（已 trim），取消/空串返回 null */
export function promptDialog(opts: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const id = ++seq;
    useConfirmStore.setState((s) => ({
      queue: [
        ...s.queue,
        {
          ...opts,
          id,
          input: { initial: opts.initial ?? "", placeholder: opts.placeholder },
          resolve: () => {},
          resolveText: (t) => {
            const v = t?.trim() ?? "";
            resolve(v === "" ? null : v);
          },
        },
      ],
    }));
  });
}

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++seq;
    useConfirmStore.setState((s) => ({ queue: [...s.queue, { ...opts, id, resolve }] }));
  });
}
