import { describe, expect, it } from "vitest";
import { findTexture, TEXTURES } from "./textures";

describe("内置纹理定义", () => {
  it("六项预设、id 唯一且顺序固定（none 打头）", () => {
    expect(TEXTURES).toHaveLength(6);
    expect(TEXTURES.map((t) => t.id)).toEqual([
      "none", "paper", "dots", "grid", "ruled", "canvas",
    ]);
    expect(new Set(TEXTURES.map((t) => t.id)).size).toBe(6);
  });

  it("none 的 css 为空串，其余五项 css 非空且形如背景图（data URI 或 gradient）", () => {
    const none = TEXTURES.find((t) => t.id === "none")!;
    expect(none.css).toBe("");
    for (const t of TEXTURES) {
      if (t.id === "none") continue;
      expect(t.css.trim().length).toBeGreaterThan(0);
      expect(/^url\(|gradient/.test(t.css)).toBe(true);
    }
  });

  it("每项 name 非空", () => {
    for (const t of TEXTURES) expect(t.name.trim().length).toBeGreaterThan(0);
  });

  it("paper / canvas 为 feTurbulence SVG data URI（baseFrequency/numOctaves 区分颗粒）", () => {
    const paper = findTexture("paper")!;
    expect(paper.css.startsWith('url("data:image/svg+xml,')).toBe(true);
    expect(paper.css).toContain("feTurbulence");
    expect(paper.css).toContain("fractalNoise");
    expect(paper.css).toContain("baseFrequency='0.9'");
    expect(paper.css).toContain("numOctaves='2'");

    const canvas = findTexture("canvas")!;
    expect(canvas.css).toContain("feTurbulence");
    expect(canvas.css).toContain("baseFrequency='0.04'");
    expect(canvas.css).toContain("numOctaves='4'");
  });

  it("grid 为双向 linear-gradient，ruled 为单向横线", () => {
    const grid = findTexture("grid")!.css;
    expect(grid.match(/linear-gradient\(/g)).toHaveLength(2);
    expect(grid).toContain("to bottom");
    expect(grid).toContain("to right");

    const ruled = findTexture("ruled")!.css;
    expect(ruled.match(/linear-gradient\(/g)).toHaveLength(1);
    expect(ruled).toContain("to bottom");
    expect(ruled).not.toContain("to right");
  });

  it("dots 为圆点阵（radial-gradient 或 SVG pattern）", () => {
    const dots = findTexture("dots")!.css;
    expect(dots.includes("radial-gradient") || dots.includes("%3Ccircle")).toBe(true);
  });

  it("findTexture 命中与未命中", () => {
    expect(findTexture("dots")?.id).toBe("dots");
    expect(findTexture("nope")).toBeUndefined();
    expect(findTexture("")).toBeUndefined();
  });
});
