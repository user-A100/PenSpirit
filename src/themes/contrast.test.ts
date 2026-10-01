import { describe, expect, it } from "vitest";
import { THEMES, backdropOf, tintSurfaces, type ThemeDef } from "./defs";

// 全主题对比度审计（阶段 4，WCAG 2.x AA）。复跑：npx vitest run src/themes/contrast.test.ts
// 分档（与界面里的用途一一对应）：
//   正文档 4.5:1（AA 普通文字）——主要文字、次要文字、稿纸正文、强调色文字、状态色文字、强调色按钮上的白字
//   提示档 3:1（AA 大字 / 界面元件）——faint：只用于占位提示、装饰性的元信息（字数、时间、快捷键胶囊），不承载必须读懂的内容
// 背景取文字实际会落在的各层：背板（侧栏 / Ribbon 贴着它）、底色、卡片、浮层。

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)) as [number, number, number];
}

function lum(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

interface Row {
  theme: string;
  fg: string;
  bg: string;
  ratio: number;
  need: number;
}

export function auditTheme(t: ThemeDef): Row[] {
  const v = t.vars;
  const surfaces: Record<string, string> = {
    背板: backdropOf(t),
    底色: v["--bg-base"],
    卡片: v["--bg-panel"],
    浮层: v["--bg-elevated"],
  };
  const tiers: [string, string, number][] = [
    ["主要文字", v["--text-primary"], 4.5],
    ["次要文字", v["--text-secondary"], 4.5],
    ["稿纸正文", v["--prose-fg"], 4.5],
    ["强调色文字", v["--accent"], 4.5],
    ["危险色文字", v["--danger"], 4.5],
    ["成功色文字", v["--success"], 4.5],
    ["警示色文字", v["--warning"], 4.5],
    ["提示文字", v["--text-faint"], 3],
  ];
  const rows: Row[] = [];
  for (const [fgName, fg, need] of tiers) {
    for (const [bgName, bg] of Object.entries(surfaces)) {
      rows.push({ theme: t.id, fg: fgName, bg: bgName, ratio: Math.round(contrast(fg, bg) * 100) / 100, need });
    }
  }
  // 彩色字压在自身 15% 淡底的标签上（卡片 / 浮层）
  for (const [fgName, key] of [["强调色文字", "--accent"], ["危险色文字", "--danger"], ["成功色文字", "--success"], ["警示色文字", "--warning"]] as const) {
    const [onCard, onFloat] = tintSurfaces(v[key], [v["--bg-panel"], v["--bg-elevated"]]);
    rows.push({ theme: t.id, fg: fgName, bg: "卡片上的同色淡底", ratio: Math.round(contrast(v[key], onCard) * 100) / 100, need: 4.5 });
    rows.push({ theme: t.id, fg: fgName, bg: "浮层上的同色淡底", ratio: Math.round(contrast(v[key], onFloat) * 100) / 100, need: 4.5 });
  }
  rows.push({ theme: t.id, fg: "危险色实底上的白字", bg: "危险色实底", ratio: Math.round(contrast("#ffffff", v["--danger-solid"]) * 100) / 100, need: 4.5 });
  // 填充按钮 / 徽标用 --accent-solid 作底（--accent 留给文字与图标）
  rows.push({ theme: t.id, fg: "强调色实底上的白字", bg: "强调色实底", ratio: Math.round(contrast("#ffffff", v["--accent-solid"]) * 100) / 100, need: 4.5 });
  return rows;
}

describe("styles.css :root 与默认主题（修正后）一致", () => {
  it("默认主题直接用 :root 的值，必须与 THEMES 里修正后的完全相同", async () => {
    // vitest 里 CSS 导入（含 ?raw）会被置空，只能直接读文件；应用的 tsconfig 不带 Node 类型，故走动态导入
    const fsName = "node:fs";
    const { readFileSync } = (await import(/* @vite-ignore */ fsName)) as { readFileSync: (p: string, enc: string) => string };
    const cwd = (globalThis as unknown as { process: { cwd(): string } }).process.cwd();
    const css = readFileSync(`${cwd}/src/styles.css`, "utf8");
    const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
    const def = THEMES.find((t) => t.id === "bixian-dark")!;
    for (const [k, val] of Object.entries(def.vars)) {
      const m = new RegExp(`${k}:\\s*([^;]+);`).exec(root);
      expect(m?.[1].trim(), k).toBe(val);
    }
  });
});

describe("全主题对比度审计（WCAG AA）", () => {
  it("所有主题的所有文字层级在所有背景上达标（0 不合格）", () => {
    const fails = THEMES.flatMap(auditTheme).filter((r) => r.ratio < r.need);
    if (fails.length) console.table(fails);
    expect(fails).toEqual([]);
  });
});
