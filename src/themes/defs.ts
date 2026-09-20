// 主题定义：十套完整配色，每套覆盖 styles.css :root 的全部 17 个 CSS 变量。
// styles.css 的 :root 即默认主题（bixian-dark）的值；其余主题由 ThemeProvider
// 注入 <style id="bixian-theme"> 覆盖（Agentero applyUiTheme 手法）。

/** 注入到 <head> 的主题样式节点 id */
export const THEME_STYLE_ID = "bixian-theme";

/** 默认主题 id：与 styles.css :root 的值保持一致，注入时直接移除覆盖节点 */
export const DEFAULT_THEME_ID = "bixian-dark";

/** 全部主题变量键（17 个）。styles.css :root 新增变量时此处与各主题需同步补齐 */
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
  "--tab-selected-bg",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.2)",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.85)",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.2)",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.85)",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.85)",
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
    "--tab-selected-bg": "rgba(255, 255, 255, 0.2)",
  },
};

// 枫叶/枫夜：移植自 Obsidian Maple 主题默认色板（color-use-custom 出厂值）。
// Maple 全部颜色由基础色相派生：浅色 h=35（暖枫）、深色 h=207（静蓝），
// 这里按其出厂色相换算成定值。出处 D:\Mycraft\research\maple\theme.css。
const maple: ThemeDef = {
  id: "maple",
  name: "枫叶",
  dark: false,
  vars: {
    // bg = hsl(35,12%,97%) / alt(35,10%,95%) / secondary(h-18, 8%,93%)
    "--bg-base": "#f8f8f6",
    "--bg-panel": "#efedec",
    "--bg-elevated": "#f4f2f1",
    "--bg-hover": "#efece8", // hsl(35,20%,78%,25%) 叠底的有效色
    "--border-subtle": "#eae8e4", // frame：hsl(35,13.2%,90.6%)
    "--border-strong": "#d2c9bc", // Maple 非激活态高亮色（暖檀线）
    "--text-primary": "#2e2b26",
    "--text-secondary": "#6e675c",
    "--text-faint": "#9b9287",
    // Maple 激活色 hsl(35,22%,56%)——标志性的柔和檀金
    "--accent": "#a79376",
    "--accent-hover": "#b9a690",
    "--accent-dim": "rgba(167, 147, 118, 0.16)",
    "--success": "#478f14",
    "--danger": "#bd5151",
    "--warning": "#c77b23",
    "--prose-fg": "#332f28",
    "--tab-selected-bg": "rgba(255, 255, 255, 0.85)",
  },
};

const mapleNight: ThemeDef = {
  id: "mapleNight",
  name: "枫夜",
  dark: true,
  vars: {
    // bg = hsl(207,5%,11%) / alt(207,10%,13%) / secondary(h-18, 6%,12%)
    "--bg-base": "#1b1c1d",
    "--bg-panel": "#1d2020",
    "--bg-elevated": "#1e2124",
    "--bg-hover": "#293137", // hsl(207,24%,50%,20%) 叠底的有效色
    "--border-subtle": "#26292d",
    "--border-strong": "#343a41",
    // 正文/主文字 = hsla(207,50%,94%,75%) 叠底有效色——Maple 标志性的低声线
    "--text-primary": "#b5bbc0",
    "--text-secondary": "#8b96a1",
    "--text-faint": "#5d6771",
    // 激活色 hsl(207,24%,44.2%)（52%×0.85 色彩不透明度）
    "--accent": "#56738c",
    "--accent-hover": "#7699ad",
    "--accent-dim": "rgba(86, 115, 140, 0.18)",
    "--success": "#7fab86",
    "--danger": "#b47777",
    "--warning": "#b89c72",
    "--prose-fg": "#b5bbc0",
    "--tab-selected-bg": "rgba(255, 255, 255, 0.2)",
  },
};

// —— Zen 主题对（墨岩/纸白）——
// 移植自 Zen 浏览器默认配色体系：整盘颜色由单一主色按 color-mix 配方派生
// （zen-browser/desktop src/zen/common/styles/zen-theme.css，参考 .tmp-zen-ref/）。
// 运行时无 color-mix 兼容负担，这里把配方预计算成定值。
const ZEN_PRIMARY = "#5b8def";

function hexChannels(h: string): number[] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channelsToHex(ch: number[]): string {
  return `#${ch.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** 等价 CSS color-mix(in srgb, a tA%, b)：sRGB 通道插值，tA 为 a 的权重 */
function mix(a: string, b: string, tA: number): string {
  const pa = hexChannels(a);
  const pb = hexChannels(b);
  return channelsToHex(pa.map((v, i) => v * tA + pb[i] * (1 - tA)));
}

/** hex → rgba() 字符串 */
function rgba(h: string, alpha: number): string {
  const [r, g, b] = hexChannels(h);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Zen 深色：石墨底 + 主色微染；边框为主色压深后的两次混入
const zenInk: ThemeDef = {
  id: "zenInk",
  name: "墨岩",
  dark: true,
  vars: {
    "--bg-base": "#1b1b1b",
    "--bg-panel": "#1f1f1f",
    "--bg-elevated": mix(ZEN_PRIMARY, "#1b1b1b", 0.05),
    "--bg-hover": mix("#ffffff", "#1b1b1b", 0.09),
    "--border-subtle": mix(mix(ZEN_PRIMARY, "#101010", 0.3), "#4f4f4f", 0.2),
    "--border-strong": mix(mix(ZEN_PRIMARY, "#101010", 0.3), "#6e6e6e", 0.35),
    "--text-primary": "#d4d4d4",
    "--text-secondary": "#9a9a9a",
    "--text-faint": "#6b6b6b",
    "--accent": ZEN_PRIMARY,
    "--accent-hover": mix(ZEN_PRIMARY, "#ffffff", 0.85),
    "--accent-dim": rgba(ZEN_PRIMARY, 0.16),
    "--success": "#4ade80",
    "--danger": "#f87171",
    "--warning": "#fbbf24",
    "--prose-fg": "#d8d8d8",
    "--tab-selected-bg": "rgba(255, 255, 255, 0.2)",
  },
};

// Zen 浅色：暖白纸面；浅色模式下主色先压暗再参与边框/悬浮配方
const zenPrimaryLight = mix(ZEN_PRIMARY, "#101010", 0.4);
const zenPaper: ThemeDef = {
  id: "zenPaper",
  name: "纸白",
  dark: false,
  vars: {
    "--bg-base": mix(ZEN_PRIMARY, "#f4f4f4", 0.03),
    "--bg-panel": mix(ZEN_PRIMARY, "#ffffff", 0.02),
    "--bg-elevated": "#ffffff",
    "--bg-hover": mix("#000000", "#fcfdfe", 0.08),
    "--border-subtle": mix(mix(zenPrimaryLight, "#ffffff", 0.2), "#ffffff", 0.5),
    "--border-strong": mix(zenPrimaryLight, "#ffffff", 0.55),
    "--text-primary": "#1f2023",
    "--text-secondary": "#4d545f",
    "--text-faint": "#8d939d",
    "--accent": zenPrimaryLight,
    "--accent-hover": mix(ZEN_PRIMARY, "#101010", 0.45),
    "--accent-dim": rgba(zenPrimaryLight, 0.1),
    "--success": "#15803d",
    "--danger": "#dc2626",
    "--warning": "#b45309",
    "--prose-fg": "#26282d",
    "--tab-selected-bg": "rgba(255, 255, 255, 0.85)",
  },
};

export const THEMES: ThemeDef[] = [
  bixianDark,
  bixianLight,
  ink,
  parchment,
  matcha,
  midnightBlue,
  maple,
  mapleNight,
  zenInk,
  zenPaper,
];

export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}
