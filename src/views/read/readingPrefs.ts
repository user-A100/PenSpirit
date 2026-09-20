import { create } from "zustand";

// 阅读模式排版偏好：localStorage 同步读（避免进入时闪烁），滑条 change 即落盘
// （与 uiScale 同策略，防抖留 T6 优化）。字段有效域见各注释，非法值由
// normalizeReadingPrefs 逐字段 clamp/回默认。

export const READING_PREFS_KEY = "bixian.reading";

export interface ReadingPrefs {
  fontSize: number; // 13-40 px，默认 19（作家助手桌面 16px + 桌面大屏余量）
  lineHeight: number; // 1.4-3.0 连续值，默认 1.9（作家助手阅读态有效区间 1.8-2.1）
  letterSpacing: number; // 0-2（em），默认 0
  paraSpacing: number; // 0-3（em）段距，默认 1（作家助手正文段距 padding-bottom 1em）
  pageWidth: number; // 480-1600 px 正文列宽，默认 800（作家助手 ≤1920 屏 1040px 同比例）
  margin: number; // 0-96 px 额外页边，默认 0
  bottomSpace: number; // 0-60（vh%），默认 30——章尾底部留白（作家助手 bottomSpace 0.3 同款）
  fontFamily: string; // "" = 默认衬线栈；"kai"/"song"/"hei" 预设映射
  textAlign: "left" | "justify"; // 默认 justify（中文书版惯例）
  indent: boolean; // 首行缩进 2em，默认 true
  bgColor: string; // #rrggbb，默认米黄（books 预设 3）
  textColor: string;
  bgImage: { id: string; path: string } | null; // T6 接入，先留字段
  bgOpacity: number; // 0-100 背景图不透明度，默认 78
}

export const defaultReadingPrefs: ReadingPrefs = {
  fontSize: 19,
  lineHeight: 1.9,
  letterSpacing: 0,
  paraSpacing: 1,
  pageWidth: 800,
  margin: 0,
  bottomSpace: 30,
  fontFamily: "",
  textAlign: "justify",
  indent: true,
  bgColor: "#f5eddd",
  textColor: "#3b3227",
  bgImage: null,
  bgOpacity: 78,
};

/** 配色七预设：白纸/暗夜/米黄/护眼绿 + 三套深色 tint（色值取自作家助手暗色皮肤） */
export const READING_BG_PRESETS: { bg: string; text: string; name: string }[] = [
  { bg: "#ffffff", text: "#1f1f1f", name: "白纸" },
  { bg: "#1a1a1a", text: "#d8d8d8", name: "暗夜" },
  { bg: "#f5eddd", text: "#3b3227", name: "米黄" },
  { bg: "#cfe8d0", text: "#2d4a33", name: "护眼绿" },
  { bg: "#363636", text: "#ebebeb", name: "深灰" },
  { bg: "#354359", text: "#dfe6f0", name: "藏青" },
  { bg: "#4e4025", text: "#e8dcc8", name: "暖褐" },
];

/** 字体预设 → 字体栈映射（"" 用 .prose-serif 默认衬线栈，不在此表） */
export const READING_FONT_STACKS: Record<string, string> = {
  kai: '"KaiTi", "STKaiti", "楷体", serif',
  song: '"SimSun", "STSong", "宋体", serif',
  hei: '"Microsoft YaHei", "PingFang SC", "黑体", sans-serif',
};

const LINE_HEIGHT_MIN = 1.4;
const LINE_HEIGHT_MAX = 3.0;

/** 有限数值 clamp 到 [min,max]，否则回默认 */
function num(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/** clamp 到 [1.4,3.0] 后取 0.1 档（作家助手滑杆同 step） */
function normLineHeight(raw: unknown): number {
  const n = num(raw, defaultReadingPrefs.lineHeight, LINE_HEIGHT_MIN, LINE_HEIGHT_MAX);
  return Math.round(n * 10) / 10;
}

function normFontFamily(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw === "" || raw in READING_FONT_STACKS ? raw : "";
}

/** 只认 #rrggbb（原生 color input 的产出格式），其余回默认 */
function normColor(raw: unknown, fallback: string): string {
  return typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function normBgImage(raw: unknown): { id: string; path: string } | null {
  if (raw == null || typeof raw !== "object") return null;
  const o = raw as { id?: unknown; path?: unknown };
  if (typeof o.id !== "string" || o.id.length === 0) return null;
  if (typeof o.path !== "string" || o.path.length === 0) return null;
  return { id: o.id, path: o.path };
}

/** 逐字段 clamp/回默认；未知字段丢弃（含 store 的 set action 之类的杂键） */
export function normalizeReadingPrefs(raw: unknown): ReadingPrefs {
  const o = raw != null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    fontSize: num(o.fontSize, defaultReadingPrefs.fontSize, 13, 40),
    lineHeight: normLineHeight(o.lineHeight),
    letterSpacing: num(o.letterSpacing, defaultReadingPrefs.letterSpacing, 0, 2),
    paraSpacing: num(o.paraSpacing, defaultReadingPrefs.paraSpacing, 0, 3),
    pageWidth: num(o.pageWidth, defaultReadingPrefs.pageWidth, 480, 1600),
    margin: num(o.margin, defaultReadingPrefs.margin, 0, 96),
    bottomSpace: num(o.bottomSpace, defaultReadingPrefs.bottomSpace, 0, 60),
    fontFamily: normFontFamily(o.fontFamily),
    textAlign: o.textAlign === "left" || o.textAlign === "justify" ? o.textAlign : "justify",
    indent: typeof o.indent === "boolean" ? o.indent : true,
    bgColor: normColor(o.bgColor, defaultReadingPrefs.bgColor),
    textColor: normColor(o.textColor, defaultReadingPrefs.textColor),
    bgImage: normBgImage(o.bgImage),
    bgOpacity: num(o.bgOpacity, defaultReadingPrefs.bgOpacity, 0, 100),
  };
}

function loadStored(): ReadingPrefs {
  try {
    const raw = localStorage.getItem(READING_PREFS_KEY);
    if (raw != null) return normalizeReadingPrefs(JSON.parse(raw));
  } catch {
    // 坏存储/JSON 解析失败 → 全默认
  }
  return defaultReadingPrefs;
}

function persist(p: ReadingPrefs): void {
  try {
    localStorage.setItem(READING_PREFS_KEY, JSON.stringify(p));
  } catch {
    // 持久化失败静默（不影响会话内使用）
  }
}

interface ReadingPrefsState extends ReadingPrefs {
  /** 合并部分字段（自动 clamp/规整）并落盘 */
  set: (partial: Partial<ReadingPrefs>) => void;
}

export const useReadingPrefs = create<ReadingPrefsState>((set) => ({
  ...loadStored(),
  set: (partial) =>
    set((s) => {
      const next = normalizeReadingPrefs({ ...s, ...partial });
      persist(next);
      return next;
    }),
}));
