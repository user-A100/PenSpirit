import type { BadgeTone } from "../ui/Badge";

// M3-T10 伏笔紧急度模型（webnovel-writer foreshadowing.js:38-58 移植，章序号 = chapters 列表下标）。
// 四态 + 两终态：overdue（过回收章）/ urgent（≤5 章或悬置倍率超 2）/ active / resolved / dropped。
//
// span（计划跨度）取 target-planted，≤0（同章回收、章序倒挂）或未定 target 一律视 1：
// 既防 0/NaN 除法，也让「未定回收章」的 score 退化为已悬置章数——悬置 2 章以上就该催收。

export type ForeshadowState = "overdue" | "urgent" | "active" | "resolved" | "dropped";

export function urgencyOf(f: {
  status: string;
  plantedIdx: number; // 埋设章序（章被软删时传 -1，展示层特判「章已删」）
  targetIdx: number | null; // 计划回收章序（null=未定）
  currentIdx: number; // 当前章序
}): { state: ForeshadowState; remaining: number | null; score: number } {
  // 未定回收章 → remaining 无法判定（不超期、不倒计时）
  const remaining = f.targetIdx != null ? f.targetIdx - f.currentIdx : null;
  const span = f.targetIdx != null ? f.targetIdx - f.plantedIdx : Number.NaN;
  const safe = span > 0 ? span : 1;
  const score = (f.currentIdx - f.plantedIdx) / safe;

  if (f.status === "resolved") return { state: "resolved", remaining, score };
  if (f.status === "dropped") return { state: "dropped", remaining, score };
  if (remaining != null && remaining < 0) return { state: "overdue", remaining, score };
  if ((remaining != null && remaining <= 5) || score >= 2) return { state: "urgent", remaining, score };
  return { state: "active", remaining, score };
}

// 四态语义色（与 T9 Badge 同色板）：超期红 / 紧急琥珀 / 活跃蓝 / 已回收绿 / 搁置灰
export const FORESHADOW_TONE: Record<ForeshadowState, BadgeTone> = {
  overdue: "red",
  urgent: "amber",
  active: "blue",
  resolved: "green",
  dropped: "neutral",
};
