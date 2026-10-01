import { create } from "zustand";

// 轻提示（Zen toast 手法）：右上角浮出、自动消失、悬停暂停；可带一个动作按钮（如「撤销」）。
// 全局单例 store，任何模块直接 toast.info(...) 即可，渲染由 <Toaster /> 负责。

export type ToastKind = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  /** 停留毫秒；0 = 不自动消失 */
  duration: number;
}

export interface ToastOptions {
  action?: ToastAction;
  duration?: number;
}

/** 同屏最多几条（多出的挤掉最早的） */
export const TOAST_MAX = 4;

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

let seq = 0;

function defaultDuration(kind: ToastKind, hasAction: boolean): number {
  if (hasAction) return 6000; // 带「撤销」的给足反应时间
  return kind === "error" ? 5000 : 2500;
}

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message, opts) => {
    const id = ++seq;
    const duration = opts?.duration ?? defaultDuration(kind, opts?.action != null);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, action: opts?.action, duration }].slice(-TOAST_MAX) }));
    return id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

export const toast = {
  info: (message: string, opts?: ToastOptions) => useToasts.getState().push("info", message, opts),
  success: (message: string, opts?: ToastOptions) => useToasts.getState().push("success", message, opts),
  error: (message: string, opts?: ToastOptions) => useToasts.getState().push("error", message, opts),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
};
