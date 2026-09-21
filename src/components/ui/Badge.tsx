import type { ReactNode } from "react";

// 语义色小徽章（M3-T9，webnovel 六色语义；T10 伏笔四态复用同一色板）。
// 颜色尽量走主题变量（success/danger/warning/accent 随主题明暗自适应）；
// 蓝色没有对应主题变量，用 color-mix 向 --text-primary 收拢保证明暗底都可读
// （WebView2 Chromium 111+ 支持，与 Tailwind v4 基线一致）。

export type BadgeTone = "neutral" | "blue" | "green" | "amber" | "red" | "purple";

const TONES: Record<BadgeTone, { fg: string; bg: string }> = {
  neutral: { fg: "var(--text-secondary)", bg: "var(--bg-hover)" },
  blue: {
    fg: "color-mix(in srgb, #60a5fa 45%, var(--text-primary))",
    bg: "color-mix(in srgb, #3b82f6 16%, transparent)",
  },
  green: { fg: "var(--success)", bg: "color-mix(in srgb, var(--success) 16%, transparent)" },
  amber: { fg: "var(--warning)", bg: "color-mix(in srgb, var(--warning) 16%, transparent)" },
  red: { fg: "var(--danger)", bg: "color-mix(in srgb, var(--danger) 16%, transparent)" },
  purple: { fg: "var(--accent)", bg: "var(--accent-dim)" },
};

export function Badge({
  tone = "neutral",
  children,
  title,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const c = TONES[tone];
  return (
    <span
      data-tone={tone}
      title={title}
      className={`inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-xs leading-none ${className}`}
      style={{ color: c.fg, background: c.bg }}
    >
      {children}
    </span>
  );
}
