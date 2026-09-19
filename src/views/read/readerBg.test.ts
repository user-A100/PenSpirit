import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://mock/${p}`,
}));

import { defaultReadingPrefs, type ReadingPrefs } from "./readingPrefs";
import { hexToRgba, readingBgStyle } from "./readerBg";

function prefsWithImage(path: string, bgOpacity: number): ReadingPrefs {
  return { ...defaultReadingPrefs, bgImage: { id: "abc", path }, bgOpacity };
}

describe("hexToRgba", () => {
  it("六位 hex 转 rgba", () => {
    expect(hexToRgba("#f5eddd", 1)).toBe("rgba(245,237,221,1)");
    expect(hexToRgba("#000000", 0)).toBe("rgba(0,0,0,0)");
    expect(hexToRgba("#1a1a1a", 0.5)).toBe("rgba(26,26,26,0.5)");
  });

  it("非法 hex 回 rgba(0,0,0,0)", () => {
    expect(hexToRgba("f5eddd", 1)).toBe("rgba(0,0,0,0)"); // 缺 #
    expect(hexToRgba("#f5ed", 1)).toBe("rgba(0,0,0,0)"); // 位数不足
    expect(hexToRgba("#zzzzzz", 1)).toBe("rgba(0,0,0,0)");
    expect(hexToRgba("", 1)).toBe("rgba(0,0,0,0)");
  });

  it("alpha 越界收敛到 0-1，浮点尾差收敛 3 位", () => {
    expect(hexToRgba("#ffffff", 2)).toBe("rgba(255,255,255,1)");
    expect(hexToRgba("#ffffff", -1)).toBe("rgba(255,255,255,0)");
    // 1 - 0.78 = 0.21999… → 收敛 0.22（遮罩公式串稳定的关键）
    expect(hexToRgba("#f5eddd", 1 - 0.78)).toBe("rgba(245,237,221,0.22)");
  });
});

describe("readingBgStyle", () => {
  it("无图：仅 backgroundColor，无 backgroundImage", () => {
    const style = readingBgStyle(defaultReadingPrefs);
    expect(style.backgroundColor).toBe("#f5eddd");
    expect(style.backgroundImage).toBeUndefined();
    expect(style.backgroundSize).toBeUndefined();
    expect(style.backgroundPosition).toBeUndefined();
  });

  it("有图：底色 + 双层同色渐变遮罩 + asset 协议 url + cover/center", () => {
    const style = readingBgStyle(prefsWithImage("C:/bg/x.png", 78));
    expect(style.backgroundColor).toBe("#f5eddd");
    const mask = "rgba(245,237,221,0.22)"; // 1 - 78%
    expect(style.backgroundImage).toBe(
      `linear-gradient(${mask}, ${mask}), url(asset://mock/C:/bg/x.png)`,
    );
    expect(style.backgroundSize).toBe("cover");
    expect(style.backgroundPosition).toBe("center");
  });

  it("不透明度 100 = 全露图（遮罩全透明），0 = 全遮（底色盖满）", () => {
    const full = readingBgStyle(prefsWithImage("a.webp", 100));
    expect(full.backgroundImage).toContain("rgba(245,237,221,0)");
    const none = readingBgStyle(prefsWithImage("a.webp", 0));
    expect(none.backgroundImage).toContain("rgba(245,237,221,1)");
  });
});
