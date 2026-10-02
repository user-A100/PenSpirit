import { create } from "zustand";

// 自定义命令的变量表单（阶段 2B）：Promise 化，填完 → 各变量的值，取消 → null。
export interface VarsRequest {
  title: string;
  names: string[];
  resolve: (values: Record<string, string> | null) => void;
}

export const useVarsDialog = create<{ req: VarsRequest | null; answer: (values: Record<string, string> | null) => void }>((set, get) => ({
  req: null,
  answer: (values) => {
    const r = get().req;
    set({ req: null });
    r?.resolve(values);
  },
}));

export function askVars(title: string, names: string[]): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    useVarsDialog.getState().req?.resolve(null);
    useVarsDialog.setState({ req: { title, names, resolve } });
  });
}
