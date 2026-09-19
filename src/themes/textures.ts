// 纸张纹理：六种内置预设（Maple「整页纸感」机制）。
//
// css 字段即 background-image 值，由 App 根部的 #texture-layer 覆盖层消费：
// background-size = 240 × scale（px），瓦片整体缩放 → 纹理密度随 scale 变化。
// 颗粒类（paper/canvas）与圆点阵（dots）用内联 SVG data URI——SVG 作为图像
// 随 background-size 均匀缩放；线条类（grid/ruled）用多色标硬边 linear-gradient
// 在 240px 瓦片内烘入 30px 周期（30 | 240 → 无缝平铺），同样随瓦片缩放。

export type TexturePresetId = "none" | "paper" | "dots" | "grid" | "ruled" | "canvas";

export interface TextureDef {
  id: TexturePresetId;
  /** 展示名（中文） */
  name: string;
  /** background-image 值；none 为空串 */
  css: string;
}

/** 细纸纹（Maple 同款）：feTurbulence 分形噪声压成半透明中灰 */
const PAPER_CSS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** 织物（帆布）：同款滤镜但大颗粒低频（baseFrequency=0.04 / numOctaves=4） */
const CANVAS_CSS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='4' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.4 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** 圆点阵：SVG <pattern> 24px 周期铺 1.1px 灰点（单条 radial-gradient 无法
 *  在瓦片内重复出点阵——多图层共享同一 background-position 会全部重叠） */
const DOTS_CSS =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E%3Cdefs%3E%3Cpattern id='d' width='24' height='24' patternUnits='userSpaceOnUse'%3E%3Ccircle cx='12' cy='12' r='1.1' fill='rgb(128,128,128)' fill-opacity='0.35'/%3E%3C/pattern%3E%3C/defs%3E%3Crect width='100%25' height='100%25' fill='url(%23d)'/%3E%3C/svg%3E\")";

/** 瓦片边长（px）：覆盖层 background-size = TEXTURE_TILE_PX × scale 的基准 */
export const TEXTURE_TILE_PX = 240;
/** 线条周期（px）：30 整除瓦片边长，平铺无缝（稿纸行距观感） */
const LINE_PERIOD = 30;

/** 在瓦片内烘入 count 条 1px 硬线（双位置色标），随 background-size 整体缩放 */
function lineTile(dir: "to bottom" | "to right", color: string): string {
  const count = TEXTURE_TILE_PX / LINE_PERIOD;
  const stops: string[] = [];
  for (let i = 0; i < count; i++) {
    const a = i * LINE_PERIOD;
    stops.push(`${color} ${a}px ${a + 1}px`, `transparent ${a + 1}px ${a + LINE_PERIOD}px`);
  }
  return `linear-gradient(${dir}, ${stops.join(", ")})`;
}

const GRID_LINE = "rgba(128,128,128,0.22)";

export const TEXTURES: TextureDef[] = [
  { id: "none", name: "无", css: "" },
  { id: "paper", name: "纸张", css: PAPER_CSS },
  { id: "dots", name: "圆点", css: DOTS_CSS },
  { id: "grid", name: "网格", css: `${lineTile("to bottom", GRID_LINE)}, ${lineTile("to right", GRID_LINE)}` },
  { id: "ruled", name: "横线", css: lineTile("to bottom", "rgba(128,128,128,0.25)") },
  { id: "canvas", name: "织物", css: CANVAS_CSS },
];

export function findTexture(id: string): TextureDef | undefined {
  return TEXTURES.find((t) => t.id === id);
}
