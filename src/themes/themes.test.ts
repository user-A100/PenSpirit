import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen, act } from "@testing-library/react";

import {
  DEFAULT_THEME_ID,
  findTheme,
  THEMES,
  THEME_STYLE_ID,
  THEME_VAR_KEYS,
} from "./defs";
import {
  APPEARANCE_STORAGE_KEY,
  applyColorTheme,
  applyMode,
  applyProse,
  applyTexture,
  applyUiScale,
  DEFAULT_APPEARANCE,
  DEFAULT_PROSE,
  DEFAULT_TEXTURE,
  loadAppearance,
  normalizeAppearance,
  PROSE_STYLE_ID,
  saveAppearance,
  ThemeProvider,
  useAppearance,
} from "./ThemeProvider";
import { findTexture, TEXTURES } from "./textures";

import { AppearancePane } from "../components/settings/AppearancePane";

// 每个用例前清场：DOM 注入物 + localStorage + store 状态
beforeEach(() => {
  localStorage.clear();
  document.getElementById(THEME_STYLE_ID)?.remove();
  document.getElementById(PROSE_STYLE_ID)?.remove();
  document.getElementById("texture-layer")?.remove();
  document.documentElement.className = "";
  document.documentElement.style.fontSize = "";
  document.documentElement.removeAttribute("data-prose-indent");
  document.documentElement.removeAttribute("data-texture");
  useAppearance.setState({
    colorTheme: DEFAULT_THEME_ID,
    mode: "system",
    uiScale: 1,
    prose: { ...DEFAULT_PROSE },
    texture: { ...DEFAULT_TEXTURE },
  });
});

describe("主题定义", () => {
  it("十套主题、id 唯一、首项为默认深色", () => {
    expect(THEMES).toHaveLength(10);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(10);
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
    expect(THEMES[0].dark).toBe(true);
  });

  it("明暗倾向：浅色系恰好为 light/maple/matcha/parchment/zenPaper", () => {
    const light = THEMES.filter((t) => !t.dark).map((t) => t.id).sort();
    expect(light).toEqual(["bixian-light", "maple", "matcha", "parchment", "zenPaper"]);
  });

  it("每套主题完整覆盖全部 17 个变量且值非空", () => {
    for (const t of THEMES) {
      expect(Object.keys(t.vars).sort()).toEqual([...THEME_VAR_KEYS].sort());
      for (const v of Object.values(t.vars)) expect(v.trim().length).toBeGreaterThan(0);
    }
  });

  it("findTheme 命中与未命中", () => {
    expect(findTheme("matcha")?.id).toBe("matcha");
    expect(findTheme("nope")).toBeUndefined();
  });
});

describe("applyColorTheme", () => {
  it("非默认主题注入 style#bixian-theme 且包含该主题全部变量", () => {
    applyColorTheme("matcha");
    const el = document.getElementById(THEME_STYLE_ID);
    expect(el).not.toBeNull();
    const css = el!.textContent ?? "";
    expect(css.startsWith(":root{")).toBe(true);
    for (const [k, v] of Object.entries(findTheme("matcha")!.vars)) {
      expect(css).toContain(`${k}:${v};`);
    }
  });

  it("切换到其它主题时重写内容", () => {
    applyColorTheme("matcha");
    applyColorTheme("ink");
    const css = document.getElementById(THEME_STYLE_ID)?.textContent ?? "";
    expect(css).toContain(findTheme("ink")!.vars["--bg-base"]);
    expect(css).not.toContain(findTheme("matcha")!.vars["--bg-base"]);
  });

  it("默认主题移除 style；未知 id 同样回落默认且不抛错", () => {
    applyColorTheme("matcha");
    applyColorTheme(DEFAULT_THEME_ID);
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull();

    applyColorTheme("matcha");
    expect(() => applyColorTheme("不存在的主题")).not.toThrow();
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull();
  });

  it("内容未变化时不重写 style（仅内容变化时写入）", () => {
    applyColorTheme("matcha");
    const el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement;
    let writes = 0;
    let inner = el.textContent ?? "";
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get: () => inner,
      set: (v: string) => { writes += 1; inner = v; },
    });

    applyColorTheme("matcha"); // 同主题：期望跳过写入
    expect(writes).toBe(0);

    applyColorTheme("parchment"); // 不同主题：写入一次
    expect(writes).toBe(1);
  });
});

describe("applyMode", () => {
  it("light/dark 切 html class", () => {
    applyMode("light", true);
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    applyMode("dark", false);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("system 按系统明暗解析", () => {
    applyMode("system", true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyMode("system", false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});

describe("applyUiScale", () => {
  it("按 16px 基准写 documentElement.fontSize，浮点干净", () => {
    applyUiScale(1.25);
    expect(document.documentElement.style.fontSize).toBe("20px");
    applyUiScale(0.8);
    expect(document.documentElement.style.fontSize).toBe("12.8px");
    applyUiScale(1.05); // 16*1.05 = 16.8000…1，需舍入干净
    expect(document.documentElement.style.fontSize).toBe("16.8px");
    applyUiScale(1);
    expect(document.documentElement.style.fontSize).toBe("16px");
  });

  it("非法输入回落 1 倍", () => {
    applyUiScale(Number.NaN);
    expect(document.documentElement.style.fontSize).toBe("16px");
  });
});

describe("外观持久化（localStorage 缓存）", () => {
  it("无存储时返回默认值", () => {
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);
  });

  it("存取往返", () => {
    const a = {
      colorTheme: "parchment",
      mode: "dark" as const,
      uiScale: 1.15,
      prose: { indent: false, lineHeight: 2.1, paraSpacing: 1.3, letterSpacing: 0.04 },
      texture: { preset: "paper" as const, opacity: 0.2, scale: 1.5, blend: "multiply" as const },
    };
    saveAppearance(a);
    expect(loadAppearance()).toEqual(a);
  });

  it("损坏 JSON / 非法字段逐一回落", () => {
    localStorage.setItem(APPEARANCE_STORAGE_KEY, "{{{not json");
    expect(loadAppearance()).toEqual(DEFAULT_APPEARANCE);

    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorTheme: "nope", mode: "solar", uiScale: 9 }),
    );
    const a = loadAppearance();
    expect(a.colorTheme).toBe(DEFAULT_THEME_ID); // 未知主题 → 默认
    expect(a.mode).toBe("system"); // 非法 mode → system
    expect(a.uiScale).toBe(1.5); // 超上限 → 夹紧
  });
});

describe("prose 排版设置（normalize）", () => {
  it("旧数据无 prose 字段回默认", () => {
    const a = normalizeAppearance({ colorTheme: "ink", mode: "light", uiScale: 1 });
    expect(a.prose).toEqual(DEFAULT_PROSE);
  });

  it("合法值原样保留", () => {
    const a = normalizeAppearance({
      prose: { indent: false, lineHeight: 2.2, paraSpacing: 1.2, letterSpacing: 0.05 },
    });
    expect(a.prose).toEqual({ indent: false, lineHeight: 2.2, paraSpacing: 1.2, letterSpacing: 0.05 });
  });

  it("越界数值夹紧到有效域", () => {
    const a = normalizeAppearance({
      prose: { indent: true, lineHeight: 9, paraSpacing: -1, letterSpacing: 5 },
    });
    expect(a.prose).toEqual({ indent: true, lineHeight: 2.4, paraSpacing: 0, letterSpacing: 0.1 });

    const b = normalizeAppearance({ prose: { lineHeight: 1, paraSpacing: 0, letterSpacing: 0 } });
    expect(b.prose.lineHeight).toBe(1.5); // 行高下界夹紧
  });

  it("非法数值（非数/NaN）与非法 indent 回默认", () => {
    const a = normalizeAppearance({
      prose: { indent: "yes", lineHeight: Number.NaN, paraSpacing: "big", letterSpacing: null },
    });
    expect(a.prose).toEqual(DEFAULT_PROSE);
  });
});

describe("texture 纹理设置（normalize）", () => {
  it("旧数据无 texture 字段回默认", () => {
    const a = normalizeAppearance({ colorTheme: "ink", mode: "light", uiScale: 1 });
    expect(a.texture).toEqual(DEFAULT_TEXTURE);
  });

  it("非法 preset 回 none，其余合法字段保留", () => {
    const a = normalizeAppearance({
      texture: { preset: "glitter", opacity: 0.2, scale: 1.5, blend: "multiply" },
    });
    expect(a.texture).toEqual({ preset: "none", opacity: 0.2, scale: 1.5, blend: "multiply" });
  });

  it("opacity/scale 越界夹紧到有效域", () => {
    const over = normalizeAppearance({
      texture: { preset: "paper", opacity: 5, scale: 9, blend: "overlay" },
    });
    expect(over.texture).toEqual({ preset: "paper", opacity: 0.4, scale: 3, blend: "overlay" });

    const under = normalizeAppearance({
      texture: { preset: "dots", opacity: -1, scale: 0.1, blend: "normal" },
    });
    expect(under.texture).toEqual({ preset: "dots", opacity: 0, scale: 0.5, blend: "normal" });
  });

  it("非法 blend 与非数值 opacity/scale 回默认", () => {
    const a = normalizeAppearance({
      texture: { preset: "grid", opacity: "thick", scale: null, blend: "vivid-light" },
    });
    expect(a.texture).toEqual({ preset: "grid", opacity: 0.12, scale: 1, blend: "soft-light" });
  });
});

describe("applyTexture 属性与覆盖层", () => {
  it("preset=none 时移除 html[data-texture]，其余写入 preset id", () => {
    applyTexture({ preset: "paper", opacity: 0.12, scale: 1, blend: "soft-light" });
    expect(document.documentElement.getAttribute("data-texture")).toBe("paper");
    applyTexture({ preset: "none", opacity: 0.12, scale: 1, blend: "soft-light" });
    expect(document.documentElement.hasAttribute("data-texture")).toBe(false);
  });

  it("覆盖层存在时写入背景图/尺寸/透明度/混合模式；非法值经 normalize 收敛", () => {
    const layer = document.createElement("div");
    layer.id = "texture-layer";
    document.body.appendChild(layer);

    // 以 gradient 型纹理断言（happy-dom 的 CSSOM 会拒收带引号空格的 data URI，
    // 浏览器/WebView2 均接受——data URI 串本身在 textures.test.ts 直接断言）
    applyTexture({ preset: "grid", opacity: 9, scale: 1.5, blend: "multiply" });
    expect(layer.style.backgroundImage).toBe(findTexture("grid")!.css);
    expect(layer.style.backgroundSize).toBe("360px"); // 240 * 1.5
    expect(layer.style.opacity).toBe("0.4"); // 越界经 clamp
    expect(layer.style.mixBlendMode).toBe("multiply");

    applyTexture({ preset: "none", opacity: 0.2, scale: 2, blend: "normal" });
    expect(layer.style.backgroundImage).toBe("");
    expect(layer.style.backgroundSize).toBe(""); // none 不留旧样式
  });

  it("覆盖层不存在时只切 html 属性，不抛错", () => {
    expect(() =>
      applyTexture({ preset: "ruled", opacity: 0.1, scale: 1, blend: "normal" }),
    ).not.toThrow();
    expect(document.documentElement.getAttribute("data-texture")).toBe("ruled");
  });
});

describe("applyProse 变量注入与缩进属性", () => {
  it("注入 --prose-* 变量到独立 style 节点，indent 开启时挂 html 属性", () => {
    applyProse({ indent: true, lineHeight: 2.2, paraSpacing: 1.2, letterSpacing: 0.05 });
    const el = document.getElementById(PROSE_STYLE_ID);
    expect(el).not.toBeNull();
    const css = el!.textContent ?? "";
    expect(css.startsWith(":root{")).toBe(true);
    expect(css).toContain("--prose-line-height:2.2;");
    expect(css).toContain("--prose-para-spacing:1.2em;");
    expect(css).toContain("--prose-letter-spacing:0.05em;");
    expect(document.documentElement.hasAttribute("data-prose-indent")).toBe(true);
  });

  it("indent=false 移除 data-prose-indent，变量保持注入", () => {
    applyProse({ indent: true, lineHeight: 2.2, paraSpacing: 1.2, letterSpacing: 0.05 });
    applyProse({ indent: false, lineHeight: 2.2, paraSpacing: 1.2, letterSpacing: 0.05 });
    expect(document.documentElement.hasAttribute("data-prose-indent")).toBe(false);
    expect(document.getElementById(PROSE_STYLE_ID)?.textContent).toContain("--prose-line-height:2.2;");
  });

  it("非法数值经 normalize 后注入默认值", () => {
    applyProse({ indent: false, lineHeight: Number.NaN, paraSpacing: -3, letterSpacing: 9 });
    const css = document.getElementById(PROSE_STYLE_ID)?.textContent ?? "";
    expect(css).toContain(`--prose-line-height:${DEFAULT_PROSE.lineHeight};`);
    expect(css).toContain(`--prose-para-spacing:0em;`);
    expect(css).toContain(`--prose-letter-spacing:0.1em;`);
  });

  it("内容一致时跳过重写（幂等）", () => {
    applyProse(DEFAULT_PROSE);
    const el = document.getElementById(PROSE_STYLE_ID) as HTMLStyleElement;
    let writes = 0;
    let inner = el.textContent ?? "";
    Object.defineProperty(el, "textContent", {
      configurable: true,
      get: () => inner,
      set: (v: string) => { writes += 1; inner = v; },
    });

    applyProse(DEFAULT_PROSE); // 同设置：期望跳过写入
    expect(writes).toBe(0);

    applyProse({ ...DEFAULT_PROSE, lineHeight: 2.4 }); // 不同：写入一次
    expect(writes).toBe(1);
  });
});

describe("appearance store", () => {
  it("store 初值从 localStorage 读取", async () => {
    localStorage.setItem(
      APPEARANCE_STORAGE_KEY,
      JSON.stringify({ colorTheme: "ink", mode: "light", uiScale: 0.9 }),
    );
    vi.resetModules();
    const { useAppearance: fresh } = await import("./ThemeProvider");
    expect(fresh.getState().colorTheme).toBe("ink");
    expect(fresh.getState().mode).toBe("light");
    expect(fresh.getState().uiScale).toBe(0.9);
    useAppearance.setState({ colorTheme: DEFAULT_THEME_ID, mode: "system", uiScale: 1 });
  });

  it("setColorTheme 即时应用并立即持久化", () => {
    useAppearance.getState().setColorTheme("midnightBlue");
    expect(useAppearance.getState().colorTheme).toBe("midnightBlue");
    expect(document.getElementById(THEME_STYLE_ID)?.textContent).toContain(
      findTheme("midnightBlue")!.vars["--accent"],
    );
    expect(loadAppearance().colorTheme).toBe("midnightBlue");
  });

  it("setColorTheme 忽略未知 id", () => {
    useAppearance.getState().setColorTheme("ghost");
    expect(useAppearance.getState().colorTheme).toBe(DEFAULT_THEME_ID);
    expect(document.getElementById(THEME_STYLE_ID)).toBeNull();
  });

  it("setMode 切 html class 并持久化", () => {
    useAppearance.getState().setMode("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(loadAppearance().mode).toBe("dark");
  });

  it("setUiScale 立即应用、按 150ms 防抖落盘且合并连续变更", () => {
    vi.useFakeTimers();
    try {
      useAppearance.getState().setUiScale(1.3);
      expect(document.documentElement.style.fontSize).toBe("20.8px"); // 立即应用
      expect(loadAppearance().uiScale).toBe(1); // 尚未落盘
      useAppearance.getState().setUiScale(0.9);
      vi.advanceTimersByTime(150);
      expect(loadAppearance().uiScale).toBe(0.9); // 只存最终值
    } finally {
      vi.useRealTimers();
    }
  });

  it("setProse 合并部分字段、即时应用并立即持久化", () => {
    useAppearance.getState().setProse({ lineHeight: 2.1 });
    const s = useAppearance.getState();
    expect(s.prose.lineHeight).toBe(2.1);
    expect(s.prose.indent).toBe(true); // 未提供的字段保留原值
    expect(document.getElementById(PROSE_STYLE_ID)?.textContent).toContain("--prose-line-height:2.1;");
    expect(loadAppearance().prose.lineHeight).toBe(2.1);

    useAppearance.getState().setProse({ indent: false });
    expect(useAppearance.getState().prose.indent).toBe(false);
    expect(document.documentElement.hasAttribute("data-prose-indent")).toBe(false);
    expect(loadAppearance().prose).toEqual({ indent: false, lineHeight: 2.1, paraSpacing: 0.9, letterSpacing: 0 });
  });

  it("setTexture 合并部分字段、即时应用并立即持久化", () => {
    useAppearance.getState().setTexture({ preset: "paper" });
    let s = useAppearance.getState();
    expect(s.texture.preset).toBe("paper");
    expect(s.texture.opacity).toBe(0.12); // 未提供的字段保留原值
    expect(document.documentElement.getAttribute("data-texture")).toBe("paper");
    expect(loadAppearance().texture.preset).toBe("paper");

    useAppearance.getState().setTexture({ opacity: 0.3, scale: 2, blend: "multiply" });
    s = useAppearance.getState();
    expect(s.texture).toEqual({ preset: "paper", opacity: 0.3, scale: 2, blend: "multiply" });
    expect(loadAppearance().texture).toEqual({ preset: "paper", opacity: 0.3, scale: 2, blend: "multiply" });
  });

  it("防抖落盘不回滚期间的即时落盘字段（缩放挂起时切明暗不被旧快照覆盖）", () => {
    vi.useFakeTimers();
    try {
      useAppearance.getState().setUiScale(1.2); // 调度防抖
      useAppearance.getState().setMode("dark"); // 即时落盘
      vi.advanceTimersByTime(150); // 防抖触发：须携带最新 mode 而非调度时的旧快照
      const a = loadAppearance();
      expect(a.mode).toBe("dark");
      expect(a.uiScale).toBe(1.2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AppearancePane", () => {
  it("渲染全部主题卡片，点击卡片激活该主题", () => {
    render(createElement(AppearancePane));
    for (const t of THEMES) expect(screen.getByText(t.name)).toBeInTheDocument();

    fireEvent.click(screen.getByText("羊皮纸"));
    expect(useAppearance.getState().colorTheme).toBe("parchment");
    expect(document.getElementById(THEME_STYLE_ID)?.textContent).toContain(
      findTheme("parchment")!.vars["--bg-base"],
    );
  });

  it("明暗三选切换 mode", () => {
    render(createElement(AppearancePane));
    // 「深色/浅色」与主题卡片角标文字相同，按按钮可访问名精确匹配
    fireEvent.click(screen.getByRole("button", { name: "深色" }));
    expect(useAppearance.getState().mode).toBe("dark");
    fireEvent.click(screen.getByRole("button", { name: "跟随系统" }));
    expect(useAppearance.getState().mode).toBe("system");
  });

  it("缩放滑条实时应用到根字号", () => {
    render(createElement(AppearancePane));
    const slider = screen.getByRole("slider", { name: "界面缩放" }) as HTMLInputElement;
    expect(slider.min).toBe("0.8");
    expect(slider.max).toBe("1.5");
    expect(slider.step).toBe("0.05");

    fireEvent.change(slider, { target: { value: "1.2" } });
    expect(useAppearance.getState().uiScale).toBe(1.2);
    expect(document.documentElement.style.fontSize).toBe("19.2px");
  });

  it("正文排版：三个滑条参数正确、行高即时注入；缩进开关切 html 属性", () => {
    render(createElement(AppearancePane));

    const lineHeight = screen.getByRole("slider", { name: "行高" }) as HTMLInputElement;
    expect(lineHeight.min).toBe("1.5");
    expect(lineHeight.max).toBe("2.4");
    expect(lineHeight.step).toBe("0.05");
    const paraSpacing = screen.getByRole("slider", { name: "段距" }) as HTMLInputElement;
    expect(paraSpacing.min).toBe("0");
    expect(paraSpacing.max).toBe("2");
    expect(paraSpacing.step).toBe("0.1");
    const letterSpacing = screen.getByRole("slider", { name: "字距" }) as HTMLInputElement;
    expect(letterSpacing.min).toBe("0");
    expect(letterSpacing.max).toBe("0.1");
    expect(letterSpacing.step).toBe("0.01");

    // 滑条即时生效：store + 变量注入 + 缩进属性（默认开启）
    fireEvent.change(lineHeight, { target: { value: "2.2" } });
    expect(useAppearance.getState().prose.lineHeight).toBe(2.2);
    expect(document.getElementById(PROSE_STYLE_ID)?.textContent).toContain("--prose-line-height:2.2;");
    expect(document.documentElement.hasAttribute("data-prose-indent")).toBe(true);

    // 开关关闭缩进：html 属性移除并落盘
    fireEvent.click(screen.getByRole("switch"));
    expect(useAppearance.getState().prose.indent).toBe(false);
    expect(document.documentElement.hasAttribute("data-prose-indent")).toBe(false);
    expect(loadAppearance().prose.indent).toBe(false);

    fireEvent.change(paraSpacing, { target: { value: "1.5" } });
    expect(useAppearance.getState().prose.paraSpacing).toBe(1.5);
    expect(document.getElementById(PROSE_STYLE_ID)?.textContent).toContain("--prose-para-spacing:1.5em;");
    fireEvent.change(letterSpacing, { target: { value: "0.03" } });
    expect(useAppearance.getState().prose.letterSpacing).toBe(0.03);
    expect(document.getElementById(PROSE_STYLE_ID)?.textContent).toContain("--prose-letter-spacing:0.03em;");
  });

  it("纸张纹理：六预设 chips；「无」时参数区隐藏，选择后滑条/下拉参数正确", () => {
    render(createElement(AppearancePane));
    // 六个预设 chips（含「无」）全部渲染；默认「无」→ 参数区隐藏
    for (const t of TEXTURES) expect(screen.getByRole("button", { name: t.name })).toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "纹理强度" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "纸张" }));
    expect(useAppearance.getState().texture.preset).toBe("paper");
    expect(document.documentElement.getAttribute("data-texture")).toBe("paper");

    const opacity = screen.getByRole("slider", { name: "纹理强度" }) as HTMLInputElement;
    expect(opacity.min).toBe("0");
    expect(opacity.max).toBe("0.4");
    expect(opacity.step).toBe("0.02");
    const scale = screen.getByRole("slider", { name: "纹理缩放" }) as HTMLInputElement;
    expect(scale.min).toBe("0.5");
    expect(scale.max).toBe("3");
    expect(scale.step).toBe("0.1");

    fireEvent.change(opacity, { target: { value: "0.26" } });
    expect(useAppearance.getState().texture.opacity).toBe(0.26);
    fireEvent.change(scale, { target: { value: "1.6" } });
    expect(useAppearance.getState().texture.scale).toBe(1.6);

    const blend = screen.getByRole("combobox", { name: "混合模式" }) as HTMLSelectElement;
    expect(blend.options).toHaveLength(4);
    fireEvent.change(blend, { target: { value: "multiply" } });
    expect(useAppearance.getState().texture.blend).toBe("multiply");
    expect(loadAppearance().texture).toEqual({ preset: "paper", opacity: 0.26, scale: 1.6, blend: "multiply" });

    // 切回「无」：参数区再次隐藏、html 属性移除并落盘
    fireEvent.click(screen.getByRole("button", { name: "无" }));
    expect(useAppearance.getState().texture.preset).toBe("none");
    expect(screen.queryByRole("slider", { name: "纹理强度" })).toBeNull();
    expect(document.documentElement.hasAttribute("data-texture")).toBe(false);
    expect(loadAppearance().texture.preset).toBe("none");
  });
});

describe("ThemeProvider 跟随系统明暗", () => {
  type ChangeFn = (e: { matches: boolean }) => void;
  let listeners: Set<ChangeFn>;
  let mqMock: { matches: boolean; addEventListener: unknown; removeEventListener: unknown };

  function installMatchMedia(initialDark: boolean) {
    listeners = new Set();
    mqMock = {
      matches: initialDark,
      addEventListener: (_: string, cb: ChangeFn) => listeners.add(cb),
      removeEventListener: (_: string, cb: ChangeFn) => listeners.delete(cb),
    };
    return vi.spyOn(window, "matchMedia").mockImplementation(
      () => mqMock as unknown as MediaQueryList,
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mode=system 时随系统明暗切换 html class", () => {
    const spy = installMatchMedia(true);
    render(createElement(ThemeProvider));

    expect(spy).toHaveBeenCalledWith("(prefers-color-scheme: dark)");
    expect(document.documentElement.classList.contains("dark")).toBe(true); // 系统深色

    act(() => { listeners.forEach((cb) => cb({ matches: false })); }); // 系统切浅色
    expect(document.documentElement.classList.contains("light")).toBe(true);

    act(() => { listeners.forEach((cb) => cb({ matches: true })); });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("mode 固定为 light/dark 时不随系统变化", () => {
    installMatchMedia(true);
    render(createElement(ThemeProvider));

    act(() => { useAppearance.getState().setMode("light"); });
    act(() => { listeners.forEach((cb) => cb({ matches: true })); }); // 系统仍深色
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("卸载后不再响应系统变化", () => {
    installMatchMedia(true);
    const { unmount } = render(createElement(ThemeProvider));
    unmount();
    document.documentElement.className = "";

    act(() => { listeners.forEach((cb) => cb({ matches: false })); });
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
