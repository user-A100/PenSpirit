import { create } from "zustand";
import type { PaneId } from "./workspace";

// 组视图模式（阶段 3A，Scrivener Group View Mode）：编辑区每个窗格各记一份——
// single = 单章正文；scrivenings / corkboard / outliner = 把当前「组」（多选 / 整本书 / 集合）
// 以串烧 / 卡片墙 / 大纲列呈现。上次用过的组模式即偏好（持久化）。

export type GroupMode = "single" | "scrivenings" | "corkboard" | "outliner";
export type LensMode = Exclude<GroupMode, "single">;

const PREF_KEY = "bixian.groupView.preferred";

function readPref(): LensMode {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "scrivenings" || v === "corkboard" || v === "outliner") return v;
  } catch {
    // 忽略
  }
  return "corkboard";
}

interface GroupViewState {
  modes: Record<PaneId, GroupMode>;
  preferred: LensMode;
  setMode: (pane: PaneId, mode: GroupMode) => void;
  /** Ctrl+1/2/3：切到该模式；已在该模式再按一次 = 回到单章 */
  toggle: (pane: PaneId, mode: LensMode) => void;
  /** 多选 / 选集合时：单章窗格切到偏好的组模式 */
  showGroup: (pane: PaneId) => void;
}

export const useGroupView = create<GroupViewState>((set, get) => ({
  modes: { a: "single", b: "single" },
  preferred: readPref(),
  setMode: (pane, mode) => {
    set((s) => ({ modes: { ...s.modes, [pane]: mode } }));
    if (mode !== "single") {
      set({ preferred: mode });
      try {
        localStorage.setItem(PREF_KEY, mode);
      } catch {
        // 忽略
      }
    }
  },
  toggle: (pane, mode) => get().setMode(pane, get().modes[pane] === mode ? "single" : mode),
  showGroup: (pane) => {
    if (get().modes[pane] === "single") get().setMode(pane, get().preferred);
  },
}));
