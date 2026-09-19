// 外观主题运行时：配色主题 / 明暗（跟随系统）/ UI 缩放。
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

export interface AppearanceSettings {
  colorTheme: string;
  mode: AppearanceMode;
  uiScale: number;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorTheme: DEFAULT_THEME_ID,
  mode: "system",
  uiScale: 1,
};

export const APPEARANCE_STORAGE_KEY = "bixian.appearance";

export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.5;
export const UI_SCALE_STEP = 0.05;
/** UI 缩放落盘防抖（拖动滑条时的写盘频率） */
const UI_SCALE_PERSIST_DEBOUNCE_MS = 150;

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

export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<AppearanceSettings>;
  return {
    colorTheme:
      typeof src.colorTheme === "string" && findTheme(src.colorTheme) ? src.colorTheme : DEFAULT_THEME_ID,
    mode: src.mode === "light" || src.mode === "dark" ? src.mode : "system",
    uiScale: clampUiScale(typeof src.uiScale === "number" ? src.uiScale : DEFAULT_APPEARANCE.uiScale),
  };
}

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw == null) return { ...DEFAULT_APPEARANCE };
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE };
  }
}

export function saveAppearance(a: AppearanceSettings): void {
  try {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorTheme: a.colorTheme, mode: a.mode, uiScale: a.uiScale }),
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
  return { colorTheme: s.colorTheme, mode: s.mode, uiScale: s.uiScale };
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
}));

/** 启动防闪烁：在 React 渲染前同步应用一次外观（main.tsx 调用） */
export function initAppearanceSync(): AppearanceSettings {
  const a = loadAppearance();
  applyColorTheme(a.colorTheme);
  applyMode(a.mode, systemPrefersDark());
  applyUiScale(a.uiScale);
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

  useEffect(() => { applyColorTheme(colorTheme); }, [colorTheme]);

  useEffect(() => { applyMode(mode, systemPrefersDark()); }, [mode]);

  useEffect(() => { applyUiScale(uiScale); }, [uiScale]);

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
