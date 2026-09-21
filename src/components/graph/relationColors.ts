// 关系类型的语义判定与 SVG 边配色（Badge 六色语义的图上版本）。
// 家族类型 = 家族树入谱依据（T5）；其余类型只出现在关系网络。

const FAMILY_TYPES = new Set(["父母", "子女", "兄弟", "配偶"]);

export function isFamilyType(t: string): boolean {
  return FAMILY_TYPES.has(t.trim());
}

export const RELATION_PRESETS = ["父母", "子女", "配偶", "兄弟", "师徒", "仇敌", "挚友"] as const;

export function edgeColor(t: string): string {
  const s = t.trim();
  if (s === "配偶") return "var(--accent)";
  if (s === "父母" || s === "子女" || s === "兄弟") return "var(--warning)";
  // 蓝无主题变量，与 Badge blue 同款 color-mix 收拢
  if (s === "师徒") return "color-mix(in srgb, #60a5fa 45%, var(--text-primary))";
  if (s === "仇敌") return "var(--danger)";
  return "var(--text-faint)";
}
