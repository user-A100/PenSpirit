import { create } from "zustand";
import { useWorkspace, type PaneId } from "./workspace";

// 就地 AI（阶段 2B）：Alt+K 就地改写选区 / Alt+Enter 光标处续写。
// store 只负责「在哪个窗格、哪种模式、第几次」；浮条本身挂在该窗格的编辑器里（要直接读光标坐标）。
export type InlineMode = "edit" | "continue";

interface InlineAiState {
  req: { pane: PaneId; mode: InlineMode; nonce: number } | null;
  open: (mode: InlineMode, pane?: PaneId) => void;
  close: () => void;
}

let nonce = 0;

export const useInlineAi = create<InlineAiState>((set) => ({
  req: null,
  open: (mode, pane) => set({ req: { pane: pane ?? useWorkspace.getState().activePane, mode, nonce: ++nonce } }),
  close: () => set({ req: null }),
}));
