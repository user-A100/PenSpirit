import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultReadingPrefs,
  normalizeReadingPrefs,
  READING_BG_PRESETS,
  READING_FONT_STACKS,
  READING_PREFS_KEY,
  useReadingPrefs,
  type ReadingPrefs,
} from "./readingPrefs";

const fullValid: ReadingPrefs = {
  ...defaultReadingPrefs,
  fontSize: 22,
  lineHeight: 2,
  letterSpacing: 1.5,
  paraSpacing: 1.2,
  pageWidth: 800,
  margin: 32,
  fontFamily: "kai",
  textAlign: "left",
  indent: false,
  bgColor: "#123456",
  textColor: "#654321",
  bgImage: { id: "ab12", path: "C:/bg/x.png" },
  bgOpacity: 50,
};

describe("normalizeReadingPrefs", () => {
  it("null/undefined/非对象 → 全默认", () => {
    expect(normalizeReadingPrefs(null)).toEqual(defaultReadingPrefs);
    expect(normalizeReadingPrefs(undefined)).toEqual(defaultReadingPrefs);
    expect(normalizeReadingPrefs("junk")).toEqual(defaultReadingPrefs);
    expect(normalizeReadingPrefs(42)).toEqual(defaultReadingPrefs);
  });

  it("部分对象只覆盖出现字段，其余回默认", () => {
    const n = normalizeReadingPrefs({ fontSize: 20 });
    expect(n.fontSize).toBe(20);
    expect(n.textAlign).toBe(defaultReadingPrefs.textAlign);
    expect(n.bgImage).toBeNull();
  });

  it("合法对象逐字段保留", () => {
    expect(normalizeReadingPrefs(fullValid)).toEqual(fullValid);
  });

  it("数值字段 clamp 到有效域", () => {
    let n = normalizeReadingPrefs({ ...fullValid, fontSize: 5 });
    expect(n.fontSize).toBe(13);
    n = normalizeReadingPrefs({ ...fullValid, fontSize: 500 });
    expect(n.fontSize).toBe(40);

    n = normalizeReadingPrefs({ ...fullValid, letterSpacing: -1 });
    expect(n.letterSpacing).toBe(0);
    n = normalizeReadingPrefs({ ...fullValid, letterSpacing: 9 });
    expect(n.letterSpacing).toBe(2);

    n = normalizeReadingPrefs({ ...fullValid, paraSpacing: -2 });
    expect(n.paraSpacing).toBe(0);
    n = normalizeReadingPrefs({ ...fullValid, paraSpacing: 99 });
    expect(n.paraSpacing).toBe(3);

    n = normalizeReadingPrefs({ ...fullValid, pageWidth: 10 });
    expect(n.pageWidth).toBe(480);
    n = normalizeReadingPrefs({ ...fullValid, pageWidth: 99999 });
    expect(n.pageWidth).toBe(1000);

    n = normalizeReadingPrefs({ ...fullValid, margin: -8 });
    expect(n.margin).toBe(0);
    n = normalizeReadingPrefs({ ...fullValid, margin: 900 });
    expect(n.margin).toBe(96);

    n = normalizeReadingPrefs({ ...fullValid, bgOpacity: -5 });
    expect(n.bgOpacity).toBe(0);
    n = normalizeReadingPrefs({ ...fullValid, bgOpacity: 900 });
    expect(n.bgOpacity).toBe(100);
  });

  it("非法类型逐字段回默认", () => {
    let n = normalizeReadingPrefs({ ...fullValid, fontSize: "big" });
    expect(n.fontSize).toBe(defaultReadingPrefs.fontSize);
    n = normalizeReadingPrefs({ ...fullValid, lineHeight: "tall" });
    expect(n.lineHeight).toBe(defaultReadingPrefs.lineHeight);
    n = normalizeReadingPrefs({ ...fullValid, fontFamily: "comic sans" });
    expect(n.fontFamily).toBe("");
    n = normalizeReadingPrefs({ ...fullValid, textAlign: "center" });
    expect(n.textAlign).toBe("justify");
    n = normalizeReadingPrefs({ ...fullValid, indent: "yes" });
    expect(n.indent).toBe(true);
    n = normalizeReadingPrefs({ ...fullValid, bgColor: 123 });
    expect(n.bgColor).toBe(defaultReadingPrefs.bgColor);
    n = normalizeReadingPrefs({ ...fullValid, textColor: null });
    expect(n.textColor).toBe(defaultReadingPrefs.textColor);
    n = normalizeReadingPrefs({ ...fullValid, bgOpacity: NaN });
    expect(n.bgOpacity).toBe(defaultReadingPrefs.bgOpacity);
    n = normalizeReadingPrefs({ ...fullValid, bgImage: "x" });
    expect(n.bgImage).toBeNull();
  });

  it("lineHeight 数值吸附到五档（1/1.25/1.5/1.75/2）", () => {
    expect(normalizeReadingPrefs({ lineHeight: 0.2 }).lineHeight).toBe(1);
    expect(normalizeReadingPrefs({ lineHeight: 1.3 }).lineHeight).toBe(1.25);
    expect(normalizeReadingPrefs({ lineHeight: 1.6 }).lineHeight).toBe(1.5);
    expect(normalizeReadingPrefs({ lineHeight: 1.9 }).lineHeight).toBe(2);
    expect(normalizeReadingPrefs({ lineHeight: 99 }).lineHeight).toBe(2);
  });

  it("颜色只认 #rrggbb，其余回默认", () => {
    let n = normalizeReadingPrefs({ ...fullValid, bgColor: "#abc" });
    expect(n.bgColor).toBe(defaultReadingPrefs.bgColor);
    n = normalizeReadingPrefs({ ...fullValid, bgColor: "#12345z" });
    expect(n.bgColor).toBe(defaultReadingPrefs.bgColor);
    n = normalizeReadingPrefs({ ...fullValid, bgColor: "#F5EDDD" });
    expect(n.bgColor).toBe("#F5EDDD");
    n = normalizeReadingPrefs({ ...fullValid, textColor: "green" });
    expect(n.textColor).toBe(defaultReadingPrefs.textColor);
  });

  it("bgImage 形状校验：缺字段/非字符串回 null，合法保留", () => {
    expect(normalizeReadingPrefs({ ...fullValid, bgImage: { id: "a" } }).bgImage).toBeNull();
    expect(
      normalizeReadingPrefs({ ...fullValid, bgImage: { id: 1, path: "p" } }).bgImage,
    ).toBeNull();
    expect(normalizeReadingPrefs({ ...fullValid, bgImage: null }).bgImage).toBeNull();
    expect(
      normalizeReadingPrefs({ ...fullValid, bgImage: { id: "a", path: "p" } }).bgImage,
    ).toEqual({ id: "a", path: "p" });
  });
});

describe("READING_BG_PRESETS", () => {
  it("四组预设，字段齐全", () => {
    expect(READING_BG_PRESETS).toHaveLength(4);
    for (const p of READING_BG_PRESETS) {
      expect(typeof p.bg).toBe("string");
      expect(p.bg).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.text).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it("米黄预设与默认配色同值（books 预设 3）", () => {
    expect(READING_BG_PRESETS[2]).toEqual({ bg: "#f5eddd", text: "#3b3227", name: "米黄" });
    expect(defaultReadingPrefs.bgColor).toBe(READING_BG_PRESETS[2].bg);
    expect(defaultReadingPrefs.textColor).toBe(READING_BG_PRESETS[2].text);
  });
});

describe("READING_FONT_STACKS", () => {
  it("kai/song/hei 三预设均有字体栈", () => {
    expect(Object.keys(READING_FONT_STACKS).sort()).toEqual(["hei", "kai", "song"]);
    for (const stack of Object.values(READING_FONT_STACKS)) {
      expect(stack.length).toBeGreaterThan(0);
    }
  });
});

describe("useReadingPrefs store", () => {
  beforeEach(() => {
    localStorage.clear();
    useReadingPrefs.setState({ ...defaultReadingPrefs });
  });

  // 初值在模块加载时同步读 localStorage，用 resetModules + 动态 import 取新实例
  async function freshStore() {
    vi.resetModules();
    return import("./readingPrefs");
  }

  it("set(partial) 合并字段并落盘 localStorage", () => {
    useReadingPrefs.getState().set({ fontSize: 25, indent: false });
    const s = useReadingPrefs.getState();
    expect(s.fontSize).toBe(25);
    expect(s.indent).toBe(false);
    expect(s.lineHeight).toBe(defaultReadingPrefs.lineHeight); // 未动字段保持
    const raw = JSON.parse(localStorage.getItem(READING_PREFS_KEY)!) as ReadingPrefs;
    expect(raw.fontSize).toBe(25);
    expect(raw.indent).toBe(false);
  });

  it("set 把越界值规整后再落盘", () => {
    useReadingPrefs.getState().set({ fontSize: 9999 });
    expect(useReadingPrefs.getState().fontSize).toBe(40);
    expect((JSON.parse(localStorage.getItem(READING_PREFS_KEY)!) as ReadingPrefs).fontSize).toBe(40);
  });

  it("进入时从 localStorage 同步恢复", async () => {
    localStorage.setItem(
      READING_PREFS_KEY,
      JSON.stringify({ fontSize: 19, textAlign: "left" }),
    );
    const { useReadingPrefs: fresh } = await freshStore();
    expect(fresh.getState().fontSize).toBe(19);
    expect(fresh.getState().textAlign).toBe("left");
    expect(fresh.getState().indent).toBe(true); // 未存字段回默认
  });

  it("坏存储（非 JSON）回默认", async () => {
    localStorage.setItem(READING_PREFS_KEY, "{not json");
    const { useReadingPrefs: fresh } = await freshStore();
    expect(fresh.getState().fontSize).toBe(defaultReadingPrefs.fontSize);
  });

  it("存储值部分非法时逐字段规整", async () => {
    localStorage.setItem(
      READING_PREFS_KEY,
      JSON.stringify({ fontSize: 300, textAlign: "center", indent: false }),
    );
    const { useReadingPrefs: fresh } = await freshStore();
    expect(fresh.getState().fontSize).toBe(40); // clamp
    expect(fresh.getState().textAlign).toBe("justify"); // 回默认
    expect(fresh.getState().indent).toBe(false); // 合法保留
  });
});
