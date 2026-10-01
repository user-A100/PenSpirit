import { create } from "zustand";
import { useWorkspace, type PaneId } from "./workspace";

// 换个说法（阶段 2C）：选中一个词 → 近义词 / 成语（AI 建议）+ 此处最可能的字（token 概率）。
// 浮层挂在对应窗格的编辑器里（要读选区坐标）。
export const useWordSwap = create<{ req: { pane: PaneId; nonce: number } | null; open: (pane?: PaneId) => void; close: () => void }>((set) => ({
  req: null,
  open: (pane) => set({ req: { pane: pane ?? useWorkspace.getState().activePane, nonce: Date.now() } }),
  close: () => set({ req: null }),
}));
