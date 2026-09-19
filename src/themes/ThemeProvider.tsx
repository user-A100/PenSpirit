// 外观主题运行时：配色主题 / 明暗（跟随系统）/ UI 缩放 / 编辑器正文排版。
//
// 持久化说明：后端 settings KV 目前没有暴露通用 get/set 命令（仅有
// get_active_provider / get_active_style 等整数位命令），appearance 暂以
// localStorage 为缓存真源（key = bixian.appearance）。待 Rust 侧补
// get_setting/set_setting 命令后，loadAppearance/saveAppearance 切到 invoke 即可，
// 上层（store / ThemeProvider / AppearancePane）无需改动。
import { useEffect } from "react";
import { create } from "zustand";
import { DEFAULT_THEME_ID, findTheme, THEME_STYLE_ID, THEME_VAR_KEYS, ThemeDef } from "./defs";

export type AppearanceMode = "system" | "light" | "dark";

/** 编辑器正文排版（仅作用于 .prose-serif / .ProseMirror，UI 其它区域不受影响） */
export interface ProseSettings {
  /** 段首缩进两字（中文小说惯例） */
  indent: boolean;
  /** 行高倍数 */
  lineHeight: number;
  /** 段距（em） */
  paraSpacing: number;
  /** 字距（em） */
  letterSpacing: number;
}

export const DEFAULT_PROSE: ProseSettings = { indent: true, lineHeight: 1.9, paraSpacing: 0.9, letterSpacing: 0 };

export interface AppearanceSettings {
  colorTheme: string;
  mode: AppearanceMode;
  uiScale: number;
  prose: ProseSettings;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorTheme: DEFAULT_THEME_ID,
  mode: "system",
  uiScale: 1,
  prose: { ...DEFAULT_PROSE },
};

export const APPEARANCE_STORAGE_KEY = "bixian.appearance";

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_STEP = 0.05;
/** UI 缩放落盘防抖（拖动滑条时的写盘频率） */
const UI_SCALE_PERSIST_DEBOUNCE_MS = 150;

export const PROSE_LINE_HEIGHT_MIN = 1.5;
export const PROSE_LINE_HEIGHT_MAX = 2.4;
export const PROSE_LINE_HEIGHT_STEP = 0.05;
export const PROSE_PARA_SPACING_MIN = 0;
export const PROSE_PARA_SPACING_MAX = 2;
export const PROSE_PARA_SPACING_STEP = 0.1;
export const PROSE_LETTER_SPACING_MIN = 0;
export const PROSE_LETTER_SPACING_MAX = 0.1;
export const PROSE_LETTER_SPACING_STEP = 0.01;

// ---------- DOM 应用 ----------

/** 主题 → `:root{--k:v;…}`（键序固定，保证同主题生成稳定字符串便于幂等比较） */
export function themeCss(theme: ThemeDef): string {
  const body = THEME_VAR_KEYS.map((k) => `${k}:${theme.vars[k]};`).join("");
  return `:root{${body}}`;
}

/**
 * 应用配色主题：非默认主题注入/更新 <style id="bixian-theme">，
 * 默认主题移除该节点（styles.css :root 即默认主题值）。
 * 幂等：节点存在且内容一致时跳过写入。
 */
export function applyColorTheme(id: string): void {
  const theme = findTheme(id);
  if (!theme || theme.id === DEFAULT_THEME_ID) {
    document.getElementById(THEME_STYLE_ID)?.remove();
    return;
  }
  const css = themeCss(theme);
  let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null;
  if (el == null) {
    el = document.createElement("style");
    el.id = THEME_STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}

export function effectiveDark(mode: AppearanceMode, systemDark: boolean): boolean {
  return mode === "dark" || (mode === "system" && systemDark);
}

/** 排版变量注入节点 id（与主题节点分离：默认主题会移除主题节点，排版变量独立存活） */
export const PROSE_STYLE_ID = "bixian-prose";

/** prose 设置 → `:root{--prose-line-height:…;--prose-para-spacing:…em;--prose-letter-spacing:…em;}` */
export function proseCss(p: ProseSettings): string {
  const n = normalizeProse(p);
  return `:root{--prose-line-height:${n.lineHeight};--prose-para-spacing:${n.paraSpacing}em;--prose-letter-spacing:${n.letterSpacing}em;}`;
}

/**
 * 应用正文排版：三项数值写成 --prose-* 变量注入独立 style 节点（styles.css
 * 的 .prose-serif / .ProseMirror p 消费，带回退默认值）；首行缩进用 html
 * data-prose-indent 属性表达（`html[data-prose-indent] .ProseMirror p` 消费，
 * 作用域天然限定编辑器）。幂等：内容一致时跳过写入。
 */
export function applyProse(p: ProseSettings): void {
  const css = proseCss(p);
  let el = document.getElementById(PROSE_STYLE_ID) as HTMLStyleElement | null;
  if (el == null) {
    el = document.createElement("style");
    el.id = PROSE_STYLE_ID;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
  if (normalizeProse(p).indent) document.documentElement.setAttribute("data-prose-indent", "");
  else document.documentElement.removeAttribute("data-prose-indent");
}

/** 界面明暗：切 html class "dark"/"light"。与配色主题正交 */
export function applyMode(mode: AppearanceMode, systemDark: boolean): void {
  const dark = effectiveDark(mode, systemDark);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}

function clampUiScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n));
}

/** UI 缩放：改根字号（rem 基准 16px）。px 硬编码的组件不随缩放 */
export function applyUiScale(scale: number): void {
  const px = Math.round(16 * clampUiScale(scale) * 1000) / 1000; // 清理 16*1.05 类浮点尾差
  document.documentElement.style.fontSize = `${px}px`;
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

// ---------- 持久化（localStorage 缓存，见文件头说明） ----------

/** 数值非法（非数/NaN）回默认，越界夹紧，并清理至多 3 位小数（滑条步进的浮点尾差） */
function clampProseNumber(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 1000) / 1000;
}

export function normalizeProse(raw: unknown): ProseSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ProseSettings>;
  return {
    indent: typeof src.indent === "boolean" ? src.indent : DEFAULT_PROSE.indent,
    lineHeight: clampProseNumber(
      src.lineHeight, PROSE_LINE_HEIGHT_MIN, PROSE_LINE_HEIGHT_MAX, DEFAULT_PROSE.lineHeight,
    ),
    paraSpacing: clampProseNumber(
      src.paraSpacing, PROSE_PARA_SPACING_MIN, PROSE_PARA_SPACING_MAX, DEFAULT_PROSE.paraSpacing,
    ),
    letterSpacing: clampProseNumber(
      src.letterSpacing, PROSE_LETTER_SPACING_MIN, PROSE_LETTER_SPACING_MAX, DEFAULT_PROSE.letterSpacing,
    ),
  };
}

export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AppearanceSettings>;
  return {
    colorTheme:
      typeof src.colorTheme === "string" && findTheme(src.colorTheme) ? src.colorTheme : DEFAULT_THEME_ID,
    mode: src.mode === "light" || src.mode === "dark" ? src.mode : "system",
    uiScale: clampUiScale(typeof src.uiScale === "number" ? src.uiScale : DEFAULT_APPEARANCE.uiScale),
    // 旧数据无 prose 字段（M3 之前）→ normalizeProse 回默认
    prose: normalizeProse(src.prose),
  };
}

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_APPEARANCE, prose: { ...DEFAULT_APPEARANCE.prose } };
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE, prose: { ...DEFAULT_APPEARANCE.prose } };
  }
}

export function saveAppearance(a: AppearanceSettings): void {
  try {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({
        colorTheme: a.colorTheme,
        mode: a.mode,
        uiScale: a.uiScale,
        prose: normalizeProse(a.prose),
      }),
    );
  } catch {
    // localStorage 不可写：静默，会话内仍生效
  }
}

// ---------- store ----------

interface AppearanceState extends AppearanceSettings {
  setColorTheme: (id: string) => void;
  setMode: (mode: AppearanceMode) => void;
  /** 立即应用到 DOM，落盘按 150ms 防抖合并 */
  setUiScale: (scale: number) => void;
  /** 合并部分排版项：立即应用到 DOM 并落盘（滑条 step 粒度，即时写盘可接受） */
  setProse: (partial: Partial<ProseSettings>) => void;
}

let scalePersistTimer: ReturnType<typeof setTimeout> | undefined;

/** 防抖落盘：触发时读取最新状态合并写入，避免与即时落盘（主题/明暗）相互覆盖回旧值 */
function persistAppearanceSoon(): void {
  if (scalePersistTimer !== undefined) clearTimeout(scalePersistTimer);
  scalePersistTimer = setTimeout(() => {
    scalePersistTimer = undefined;
    saveAppearance(snapshot(useAppearance.getState()));
  }, UI_SCALE_PERSIST_DEBOUNCE_MS);
}

function snapshot(s: AppearanceState): AppearanceSettings {
  return { colorTheme: s.colorTheme, mode: s.mode, uiScale: s.uiScale, prose: s.prose };
}

export const useAppearance = create<AppearanceState>((set, get) => ({
  ...loadAppearance(),
  setColorTheme: (id) => {
    if (!findTheme(id)) return;
    applyColorTheme(id);
    set({ colorTheme: id });
    saveAppearance(snapshot(get()));
  },
  setMode: (mode) => {
    applyMode(mode, systemPrefersDark());
    set({ mode });
    saveAppearance(snapshot(get()));
  },
  setUiScale: (scale) => {
    const clamped = clampUiScale(scale);
    applyUiScale(clamped);
    set({ uiScale: clamped });
    persistAppearanceSoon();
  },
  setProse: (partial) => {
    const prose = normalizeProse({ ...get().prose, ...partial });
    applyProse(prose);
    set({ prose });
    saveAppearance(snapshot(get()));
  },
}));

/** 启动防闪烁：在 React 渲染前同步应用一次外观（main.tsx 调用） */
export function initAppearanceSync(): AppearanceSettings {
  const a = loadAppearance();
  applyColorTheme(a.colorTheme);
  applyMode(a.mode, systemPrefersDark());
  applyUiScale(a.uiScale);
  applyProse(a.prose);
  return a;
}

// ---------- Provider 组件 ----------

/**
 * 外观提供者：挂载后响应 store 变化应用 DOM；mode=system 时倾听
 * 操作系统明暗切换。无 Context——状态走全局 useAppearance store。
 */
export function ThemeProvider({ children }: { children?: React.ReactNode }) {
  const colorTheme = useAppearance((s) => s.colorTheme);
  const mode = useAppearance((s) => s.mode);
  const uiScale = useAppearance((s) => s.uiScale);
  const prose = useAppearance((s) => s.prose);

  useEffect(() => { applyColorTheme(colorTheme); }, [colorTheme]);

  useEffect(() => { applyMode(mode, systemPrefersDark()); }, [mode]);

  useEffect(() => { applyUiScale(uiScale); }, [uiScale]);

  useEffect(() => { applyProse(prose); }, [prose]);

  useEffect(() => {
    if (mode !== "system" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => applyMode("system", e.matches);
    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    }
    mq.addListener(onChange); // 旧 API 兜底
    return () => mq.removeListener(onChange);
  }, [mode]);

  return <>{children}</>;
}
