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
  applyUiScale,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  ThemeProvider,
  useAppearance,
} from "./ThemeProvider";

import { AppearancePane } from "../components/settings/AppearancePane";

// 每个用例前清场：DOM 注入物 + localStorage + store 状态
beforeEach(() => {
  localStorage.clear();
  document.getElementById(THEME_STYLE_ID)?.remove();
  document.documentElement.className = "";
  document.documentElement.style.fontSize = "";
  useAppearance.setState({ colorTheme: DEFAULT_THEME_ID, mode: "system", uiScale: 1 });
});

describe("主题定义", () => {
  it("六套主题、id 唯一、首项为默认深色", () => {
    expect(THEMES).toHaveLength(6);
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(6);
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
    expect(THEMES[0].dark).toBe(true);
  });

  it("明暗倾向：浅色系恰好为 light/parchment/matcha", () => {
    const light = THEMES.filter((t) => !t.dark).map((t) => t.id).sort();
    expect(light).toEqual(["bixian-light", "matcha", "parchment"]);
  });

  it("每套主题完整覆盖全部 16 个变量且值非空", () => {
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
    const a = { colorTheme: "parchment", mode: "dark" as const, uiScale: 1.15 };
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
    const slider = screen.getByRole("slider") as HTMLInputElement;
    expect(slider.min).toBe("0.8");
    expect(slider.max).toBe("1.5");
    expect(slider.step).toBe("0.05");

    fireEvent.change(slider, { target: { value: "1.2" } });
    expect(useAppearance.getState().uiScale).toBe(1.2);
    expect(document.documentElement.style.fontSize).toBe("19.2px");
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
