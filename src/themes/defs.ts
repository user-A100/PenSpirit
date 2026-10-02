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
  // 阶段 4：强调色 / 危险色实底（填充按钮的底，保证上面的白字达标）；由对比度修正统一派生，主题不手写
  "--accent-solid",
  "--danger-solid",
] as const;

export type ThemeVarKey = (typeof THEME_VAR_KEYS)[number];

export interface ThemeDef {
  id: string;
  /** 展示名（中文） */
  name: string;
  /** 明暗倾向：true=深色底浅色字 */
  dark: boolean;
  /** 明暗配对主题 id：界面明暗与本主题倾向相反时（如跟随系统转浅色）改用它 */
  pair?: string;
  /** 完整覆盖 THEME_VAR_KEYS 的变量表 */
  vars: Record<ThemeVarKey, string>;
}

/** 手写的主题：派生变量（--accent-solid / --danger-solid）由 accessible() 统一补上 */
type AuthoredTheme = Omit<ThemeDef, "vars"> & { vars: Record<Exclude<ThemeVarKey, "--accent-solid" | "--danger-solid">, string> };

const bixianDark: AuthoredTheme = {
  id: "bixian-dark",
  name: "暗夜（默认）",
  dark: true,
  pair: "bixian-light",
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

const bixianLight: AuthoredTheme = {
  id: "bixian-light",
  name: "晨光",
  dark: false,
  pair: "bixian-dark",
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

const ink: AuthoredTheme = {
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

const parchment: AuthoredTheme = {
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

const matcha: AuthoredTheme = {
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

const midnightBlue: AuthoredTheme = {
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
const maple: AuthoredTheme = {
  id: "maple",
  name: "枫叶",
  dark: false,
  pair: "mapleNight",
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

const mapleNight: AuthoredTheme = {
  id: "mapleNight",
  name: "枫夜",
  dark: true,
  pair: "maple",
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
const zenInk: AuthoredTheme = {
  id: "zenInk",
  name: "墨岩",
  dark: true,
  pair: "zenPaper",
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
const zenPaper: AuthoredTheme = {
  id: "zenPaper",
  name: "纸白",
  dark: false,
  pair: "zenInk",
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

// —— 对比度修正（阶段 4，WCAG 2.x AA）——
// 手写的配色表达的是「感觉」（底色 + 前景的色相）。上线前统一过一遍对比度：前景色保持色相与彩度，
// 只在 OKLab 里调明度（深色主题调亮、浅色主题调暗），刚好让它在文字会落到的每一层背景
// （背板 / 底色 / 卡片 / 浮层）上达标——正文档 4.5:1，提示档（faint）3:1；
// 另派生 --accent-solid：强调色压暗到白字达标为止，作填充按钮的底（--accent 本身留给文字与图标）。
// 审计脚本：src/themes/contrast.test.ts。

export const AA_TEXT = 4.5;
export const AA_HINT = 3;
/** 留一点余量，免得舍入后卡在线上 */
const AA_MARGIN = 0.05;

function relLum(hex: string): number {
  const [r, g, b] = hexChannels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 对比度（两个 #rrggbb） */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) => {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, v)) * 255);
};

function toOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexChannels(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return channelsToHex([
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]);
}

/** 只调 OKLab 明度（保持色相与彩度） */
function shiftLightness(hex: string, dL: number): string {
  const [L, a, b] = toOklab(hex);
  return fromOklab([Math.min(1, Math.max(0, L + dL)), a, b]);
}

/** 把前景色调到在所有背景上都达到 need：深色主题往亮调、浅色主题往暗调；本就达标的原样返回。
 *  背景可以依赖前景本身（同色淡底的标签：底色随前景一起变） */
function fitForeground(fg: string, surfaces: string[] | ((c: string) => string[]), need: number, lighten: boolean): string {
  const of = typeof surfaces === "function" ? surfaces : () => surfaces;
  let c = fg;
  for (let i = 0; i < 200 && of(c).some((s) => contrastRatio(c, s) < need + AA_MARGIN); i++) c = shiftLightness(c, lighten ? 0.005 : -0.005);
  return c;
}

/** 同色淡底（标签 / 胶囊：彩色字压在自身 15% 的淡底上） */
export const TINT = 0.15;
export function tintSurfaces(fg: string, cards: string[]): string[] {
  return cards.map((s) => mix(fg, s, TINT));
}

/** 补上派生变量并做对比度修正 */
export function accessible(t: AuthoredTheme): ThemeDef {
  const v = { ...t.vars } as Record<ThemeVarKey, string>;
  const surfaces = [backdropOf(t as ThemeDef), v["--bg-base"], v["--bg-panel"], v["--bg-elevated"]];
  for (const k of ["--text-primary", "--text-secondary", "--prose-fg"] as const) {
    v[k] = fitForeground(v[k], surfaces, AA_TEXT, t.dark);
  }
  // 彩色字还会压在自身的淡底标签上（卡片 / 浮层上的 15% 同色底）
  for (const k of ["--accent", "--danger", "--success", "--warning"] as const) {
    v[k] = fitForeground(v[k], (c) => [...surfaces, ...tintSurfaces(c, [v["--bg-panel"], v["--bg-elevated"]])], AA_TEXT, t.dark);
  }
  v["--text-faint"] = fitForeground(v["--text-faint"], surfaces, AA_HINT, t.dark);
  if (v["--accent"] !== t.vars["--accent"]) {
    // 强调色动过：悬停色与淡底随之重算（悬停沿同一方向再走一小步；淡底沿用原透明度）
    v["--accent-hover"] = shiftLightness(v["--accent"], t.dark ? 0.04 : -0.04);
    const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(t.vars["--accent-dim"])?.[1] ?? "0.15";
    v["--accent-dim"] = rgba(v["--accent"], Number(alpha));
  }
  // 强调色 / 危险色实底：白字达标为止一路压暗
  v["--accent-solid"] = fitForeground(v["--accent"], ["#ffffff"], AA_TEXT, false);
  v["--danger-solid"] = fitForeground(v["--danger"], ["#ffffff"], AA_TEXT, false);
  return { ...t, vars: v };
}

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
].map(accessible);

export function findTheme(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id);
}

/**
 * 实际生效的主题：所选主题的明暗倾向与界面明暗相反、且有配对主题时换成配对主题；
 * 无配对的单态主题（墨色/午夜蓝/羊皮纸/抹茶）保持自身。
 */
export function resolveThemeId(colorTheme: string, wantDark: boolean): string {
  const t = findTheme(colorTheme);
  if (!t) return colorTheme;
  if (t.dark === wantDark || !t.pair || !findTheme(t.pair)) return t.id;
  return t.pair;
}

/** 背板色：bg-base 再压一档。Zen 的窗口背板与内容卡差一档但不刺眼
 *  （深色：卡 #202020 / 背板 ~#131313；浅色：卡 #fff / 背板 ~#ebebeb） */
export function backdropOf(theme: Pick<ThemeDef, "vars" | "dark">): string {
  return mix(theme.vars["--bg-base"], "#000000", theme.dark ? 0.7 : 0.94);
}
