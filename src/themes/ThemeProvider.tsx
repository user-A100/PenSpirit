// 外观主题运行时：配色主题 / 明暗（跟随系统）/ UI 缩放 / 编辑器正文排版 / 纸张纹理。
//
// 持久化说明：后端 settings KV 目前没有暴露通用 get/set 命令（仅有
// get_active_provider / get_active_style 等整数位命令），appearance 暂以
// localStorage 为缓存真源（key = bixian.appearance）。待 Rust 侧补
// get_setting/set_setting 命令后，loadAppearance/saveAppearance 切到 invoke 即可，
// 上层（store / ThemeProvider / AppearancePane）无需改动。
import { useEffect } from "react";
import { create } from "zustand";
import { DEFAULT_THEME_ID, findTheme, THEME_STYLE_ID, THEME_VAR_KEYS, ThemeDef } from "./defs";
import { findTexture, TexturePresetId, TEXTURE_TILE_PX } from "./textures";

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

/** 纹理混合模式（覆盖层 mixBlendMode；soft-light 深浅主题通吃） */
export type TextureBlend = "normal" | "multiply" | "overlay" | "soft-light";

/** 纸张纹理（App 根部 #texture-layer 覆盖层消费，整页铺满） */
export interface TextureSettings {
  /** 预设（none = 不渲染覆盖层） */
  preset: TexturePresetId;
  /** 强度 0-0.4（常用 0.06-0.25） */
  opacity: number;
  /** 缩放 0.5-3（瓦片 = 240 × scale px，密度随之变化） */
  scale: number;
  blend: TextureBlend;
}

export const DEFAULT_TEXTURE: TextureSettings = { preset: "none", opacity: 0.12, scale: 1, blend: "soft-light" };

export interface AppearanceSettings {
  colorTheme: string;
  mode: AppearanceMode;
  uiScale: number;
  prose: ProseSettings;
  texture: TextureSettings;
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  colorTheme: DEFAULT_THEME_ID,
  mode: "system",
  uiScale: 1,
  prose: { ...DEFAULT_PROSE },
  texture: { ...DEFAULT_TEXTURE },
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

export const TEXTURE_OPACITY_MIN = 0;
export const TEXTURE_OPACITY_MAX = 0.4;
export const TEXTURE_OPACITY_STEP = 0.02;
export const TEXTURE_SCALE_MIN = 0.5;
export const TEXTURE_SCALE_MAX = 3;
export const TEXTURE_SCALE_STEP = 0.1;

const TEXTURE_BLENDS: readonly TextureBlend[] = ["normal", "multiply", "overlay", "soft-light"];

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

/** 纹理覆盖层节点 id（App 根部渲染，React 内联 style 为主；此处作补写） */
export const TEXTURE_LAYER_ID = "texture-layer";

/**
 * 应用纸张纹理：preset 写到 html[data-texture]（CSS 可挂勾）；#texture-layer
 * 已由 React 按 store 内联渲染，这里对现存节点补写同样四项（供非渲染路径
 * 调用/测试）。preset=none 时清空背景并移除属性。幂等。
 */
export function applyTexture(t: TextureSettings): void {
  const n = normalizeTexture(t);
  if (n.preset === "none") document.documentElement.removeAttribute("data-texture");
  else document.documentElement.setAttribute("data-texture", n.preset);

  const layer = document.getElementById(TEXTURE_LAYER_ID);
  if (layer == null) return;
  const def = findTexture(n.preset);
  if (def == null || def.css === "") {
    layer.style.backgroundImage = "";
    layer.style.backgroundSize = "";
    layer.style.opacity = "";
    layer.style.mixBlendMode = "";
    return;
  }
  layer.style.backgroundImage = def.css;
  layer.style.backgroundSize = `${TEXTURE_TILE_PX * n.scale}px`;
  layer.style.opacity = String(n.opacity);
  layer.style.mixBlendMode = n.blend;
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
function clampNumber(n: unknown, min: number, max: number, fallback: number): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 1000) / 1000;
}

export function normalizeProse(raw: unknown): ProseSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<ProseSettings>;
  return {
    indent: typeof src.indent === "boolean" ? src.indent : DEFAULT_PROSE.indent,
    lineHeight: clampNumber(
      src.lineHeight, PROSE_LINE_HEIGHT_MIN, PROSE_LINE_HEIGHT_MAX, DEFAULT_PROSE.lineHeight,
    ),
    paraSpacing: clampNumber(
      src.paraSpacing, PROSE_PARA_SPACING_MIN, PROSE_PARA_SPACING_MAX, DEFAULT_PROSE.paraSpacing,
    ),
    letterSpacing: clampNumber(
      src.letterSpacing, PROSE_LETTER_SPACING_MIN, PROSE_LETTER_SPACING_MAX, DEFAULT_PROSE.letterSpacing,
    ),
  };
}

export function normalizeTexture(raw: unknown): TextureSettings {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Partial<TextureSettings>;
  return {
    preset:
      typeof src.preset === "string" && findTexture(src.preset)
        ? (src.preset as TexturePresetId)
        : DEFAULT_TEXTURE.preset,
    opacity: clampNumber(
      src.opacity, TEXTURE_OPACITY_MIN, TEXTURE_OPACITY_MAX, DEFAULT_TEXTURE.opacity,
    ),
    scale: clampNumber(
      src.scale, TEXTURE_SCALE_MIN, TEXTURE_SCALE_MAX, DEFAULT_TEXTURE.scale,
    ),
    blend:
      typeof src.blend === "string" && (TEXTURE_BLENDS as readonly string[]).includes(src.blend)
        ? (src.blend as TextureBlend)
        : DEFAULT_TEXTURE.blend,
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
    // 旧数据无 texture 字段（M3-T3 之前）→ normalizeTexture 回默认
    texture: normalizeTexture(src.texture),
  };
}

export function loadAppearance(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (raw == null) {
      return { ...DEFAULT_APPEARANCE, prose: { ...DEFAULT_APPEARANCE.prose }, texture: { ...DEFAULT_APPEARANCE.texture } };
    }
    return normalizeAppearance(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_APPEARANCE, prose: { ...DEFAULT_APPEARANCE.prose }, texture: { ...DEFAULT_APPEARANCE.texture } };
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
        texture: normalizeTexture(a.texture),
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
  /** 合并部分纹理项：立即应用到 DOM 并落盘（与 setProse 同款策略） */
  setTexture: (partial: Partial<TextureSettings>) => void;
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
  return {
    colorTheme: s.colorTheme,
    mode: s.mode,
    uiScale: s.uiScale,
    prose: s.prose,
    texture: s.texture,
  };
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
  setTexture: (partial) => {
    const texture = normalizeTexture({ ...get().texture, ...partial });
    applyTexture(texture);
    set({ texture });
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
  applyTexture(a.texture);
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
  const texture = useAppearance((s) => s.texture);

  useEffect(() => { applyColorTheme(colorTheme); }, [colorTheme]);

  useEffect(() => { applyMode(mode, systemPrefersDark()); }, [mode]);

  useEffect(() => { applyUiScale(uiScale); }, [uiScale]);

  useEffect(() => { applyProse(prose); }, [prose]);

  useEffect(() => { applyTexture(texture); }, [texture]);

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
