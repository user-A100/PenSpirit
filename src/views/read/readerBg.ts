import type { CSSProperties } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { ReadingPrefs } from "./readingPrefs";

// 阅读背景样式合成（M3-T6）：
// - 背景图绝不用 data-URL——WebView2 下文件路径经 convertFileSrc 走 asset 协议
//   （tauri.conf.json assetProtocol.scope = $APPDATA/background/*）
// - 有图时叠 books 同款「双层同色渐变遮罩」：底色以 (1 - 不透明度) 的 alpha
//   盖在图上，滑条调的是图片露出的程度

/** "#rrggbb" + alpha(0-1) → "rgba(r,g,b,a)"；非法 hex 回 "rgba(0,0,0,0)" */
export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return "rgba(0,0,0,0)";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  // 1-0.78 这类浮点尾差收敛到 3 位小数（0.22），保证公式串稳定可比
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 1000) / 1000;
  return `rgba(${r},${g},${b},${a})`;
}

/** ReadView 正文容器背景：无图仅底色；有图 = 底色兜底 + 同色渐变遮罩 × cover 居中 */
export function readingBgStyle(p: ReadingPrefs): CSSProperties {
  if (p.bgImage == null || p.bgImage.path === "") {
    return { backgroundColor: p.bgColor };
  }
  const mask = hexToRgba(p.bgColor, 1 - p.bgOpacity / 100);
  return {
    backgroundColor: p.bgColor,
    backgroundImage: `linear-gradient(${mask}, ${mask}), url(${convertFileSrc(p.bgImage.path)})`,
    backgroundSize: "cover",
    backgroundPosition: "center",
  };
}
