import { create } from "zustand";

// 侧栏（Binder）交互态：行内重命名目标。阶段 3A 起扩展选择集、展开态等。
export type RenameTarget = { kind: "chapter" | "book"; id: number };

interface BinderState {
  renaming: RenameTarget | null;
  startRename: (target: RenameTarget) => void;
  stopRename: () => void;
}

export const useBinder = create<BinderState>((set) => ({
  renaming: null,
  startRename: (target) => set({ renaming: target }),
  stopRename: () => set({ renaming: null }),
}));
