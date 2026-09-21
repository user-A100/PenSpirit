import type { HTMLAttributes } from "react";

// 统一卡片外壳（M6：kindling Press 卡片语法 × zen 皮肤）。
// - variant: flat=透明底（dock 列表卡，透出 panel 底） raised=elevated 底（全页/网格卡）
// - pad:     sm=dock 窄卡 (px-3 py-2.5)  md=全页卡 (p-4)
// - interactive: 可交互卡——hover 只变边框色（kindling 律动：不动布局、不位移）
// - selected:    选中卡——accent 边框 + accent-dim 洗色（kindling 模板卡选中语法）
// 根元素恒带 group：卡内次级操作用 opacity-0 group-hover:opacity-100 浮现。
type CardProps = HTMLAttributes<HTMLDivElement> & {
  variant?: "flat" | "raised";
  pad?: "sm" | "md";
  interactive?: boolean;
  selected?: boolean;
};

export function Card({
  variant = "raised",
  pad = "md",
  interactive = false,
  selected = false,
  className = "",
  children,
  ...rest
}: CardProps) {
  const padCls = pad === "sm" ? "px-3 py-2.5" : "p-4";
  // selected 的洗色底与 raised 底互斥（同属性冲突不保证覆盖顺序），选中时只出洗色。
  const surface = selected || variant === "flat" ? "" : "bg-[var(--bg-elevated)]";
  const state = selected
    ? "border-[color:var(--accent)] bg-[var(--accent-dim)]"
    : interactive
      ? "border-[color:var(--border-subtle)] transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]"
      : "border-[color:var(--border-subtle)]";
  return (
    <div
      className={`group rounded-[var(--radius-md)] border ${padCls} ${surface} ${state} ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
