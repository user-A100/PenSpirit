// 主题定义：六套完整配色，每套覆盖 styles.css :root 的全部 16 个 CSS 变量。
// styles.css 的 :root 即默认主题（bixian-dark）的值；其余主题由 ThemeProvider
// 注入 <style id="bixian-theme"> 覆盖（Agentero applyUiTheme 手法）。

/** 注入到 <head> 的主题样式节点 id */
export const THEME_STYLE_ID = "bixian-theme";

/** 默认主题 id：与 styles.css :root 的值保持一致，注入时直接移除覆盖节点 */
export const DEFAULT_THEME_ID = "bixian-dark";

/** 全部主题变量键（16 个）。styles.css :root 新增变量时此处与各主题需同步补齐 */
export const THEME_VAR_KEYS = [
  "--bg-base",
  "--bg-panel",
  "--bg-elevated",
  "--bg-hover",
  "--border-subtle",
  "--border-strong",
  "--text-primary",
  "--text-secondary",
  "--text-faint",
  "--accent",
  "--accent-hover",
  "--accent-dim",
  "--success",
  "--danger",
  "--warning",
  "--prose-fg",
] as const;

export type ThemeVarKey = (typeof THEME_VAR_KEYS)[number];

export interface ThemeDef {
  id: string;
  /** 展示名（中文） */
  name: string;
  /** 明暗倾向：true=深色底浅色字。仅作展示角标与语义标注，与 mode（界面明暗）正交 */
  dark: boolean;
  /** 完整覆盖 THEME_VAR_KEYS 的变量表 */
  vars: Record<ThemeVarKey, string>;
}

const bixianDark: ThemeDef = {
  id: "bixian-dark",
  name: "暗夜（默认）",
  dark: true,
  vars: {
    "--bg-base": "#17171a",
    "--bg-panel": "#1d1d21",
    "--bg-elevated": "#242429",
    "--bg-hover": "#2a2a30",
    "--border-subtle": "#2a2a30",
    "--border-strong": "#3a3a42",
    "--text-primary": "#e8e8ea",
    "--text-secondary": "#a0a0a8",
    "--text-faint": "#6b6b74",
    "--accent": "#7c6ff0",
    "--accent-hover": "#8f83f5",
    "--accent-dim": "rgba(124, 111, 240, 0.15)",
    "--success": "#4ade80",
    "--danger": "#f87171",
    "--warning": "#fbbf24",
    "--prose-fg": "#e4e4e8",
  },
};

const bixianLight: ThemeDef = {
  id: "bixian-light",
  name: "晨光",
  dark: false,
  vars: {
    "--bg-base": "#f6f6f8",
    "--bg-panel": "#ffffff",
    "--bg-elevated": "#f0f0f4",
    "--bg-hover": "#e8e8ee",
    "--border-subtle": "#e3e3ea",
    "--border-strong": "#c8c8d4",
    "--text-primary": "#1f2126",
    "--text-secondary": "#5a5d68",
    "--text-faint": "#8f93a0",
    "--accent": "#6257e8",
    "--accent-hover": "#4f44d6",
    "--accent-dim": "rgba(98, 87, 232, 0.10)",
    "--success": "#15803d",
    "--danger": "#dc2626",
    "--warning": "#b45309",
    "--prose-fg": "#2a2c33",
  },
};

const ink: ThemeDef = {
  id: "ink",
  name: "墨色",
  dark: true,
  vars: {
    "--bg-base": "#000000",
    "--bg-panel": "#0a0a0a",
    "--bg-elevated": "#141414",
    "--bg-hover": "#1f1f1f",
    "--border-subtle": "#1f1f1f",
    "--border-strong": "#303030",
    "--text-primary": "#f2f2f2",
    "--text-secondary": "#b8b8b8",
    "--text-faint": "#7a7a7a",
    "--accent": "#9a8ffb",
    "--accent-hover": "#aea4ff",
    "--accent-dim": "rgba(154, 143, 251, 0.18)",
    "--success": "#4ade80",
    "--danger": "#ff8a8a",
    "--warning": "#fcd34d",
    "--prose-fg": "#e8e8e8",
  },
};

const parchment: ThemeDef = {
  id: "parchment",
  name: "羊皮纸",
  dark: false,
  vars: {
    "--bg-base": "#ece3d1",
    "--bg-panel": "#f5eddd",
    "--bg-elevated": "#faf4e8",
    "--bg-hover": "#e3d7bf",
    "--border-subtle": "#dccdb0",
    "--border-strong": "#bfa984",
    "--text-primary": "#3b3227",
    "--text-secondary": "#6d6152",
    "--text-faint": "#8f8072",
    // 印章朱红：羊皮纸上的点睛色，白字按钮对比 ≥5:1
    "--accent": "#b3432b",
    "--accent-hover": "#c4553c",
    "--accent-dim": "rgba(179, 67, 43, 0.12)",
    "--success": "#4d7c3f",
    "--danger": "#b3362b",
    "--warning": "#9a6700",
    "--prose-fg": "#43382a",
  },
};

const matcha: ThemeDef = {
  id: "matcha",
  name: "抹茶",
  dark: false,
  vars: {
    "--bg-base": "#e4ece0",
    "--bg-panel": "#eef3ea",
    "--bg-elevated": "#f4f8f1",
    "--bg-hover": "#dde7d7",
    "--border-subtle": "#d3e0cc",
    "--border-strong": "#a9bfa1",
    "--text-primary": "#2b332b",
    "--text-secondary": "#5b685b",
    "--text-faint": "#84917f",
    "--accent": "#3f7150",
    "--accent-hover": "#356044",
    "--accent-dim": "rgba(63, 113, 80, 0.12)",
    "--success": "#2f7d4f",
    "--danger": "#b3271e",
    "--warning": "#946200",
    "--prose-fg": "#333d33",
  },
};

const midnightBlue: ThemeDef = {
  id: "midnightBlue",
  name: "午夜蓝",
  dark: true,
  vars: {
    "--bg-base": "#0d1420",
    "--bg-panel": "#121b2a",
    "--bg-elevated": "#182437",
    "--bg-hover": "#1f2d44",
    "--border-subtle": "#1f2d44",
    "--border-strong": "#2c3f5c",
    "--text-primary": "#e6eaf2",
    "--text-secondary": "#9aa8c0",
    "--text-faint": "#5d6e8c",
    "--accent": "#5b8def",
    "--accent-hover": "#70a0f5",
    "--accent-dim": "rgba(91, 141, 239, 0.16)",
    "--success": "#4ade80",
    "--danger": "#ff8a80",
    "--warning": "#fbbf24",
    "--prose-fg": "#dde4f0",
  },
};

export const THEMES: ThemeDef[] = [bixianDark, bixianLight, ink, parchment, matcha, midnightBlue];

export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}
