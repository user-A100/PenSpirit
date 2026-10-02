import { create } from "zustand";

// 命令面板（Ctrl+K）开关态。initial 以 ">" 开头时只搜命令（VS Code 约定）。
interface PaletteState {
  open: boolean;
  initial: string;
  /** 每次打开自增，组件据此重置输入与选中 */
  seq: number;
  openPalette: (initial?: string) => void;
  close: () => void;
}

export const usePalette = create<PaletteState>((set) => ({
  open: false,
  initial: "",
  seq: 0,
  openPalette: (initial = "") => set((s) => ({ open: true, initial, seq: s.seq + 1 })),
  close: () => set({ open: false }),
}));
