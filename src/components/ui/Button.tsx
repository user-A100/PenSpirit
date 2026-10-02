import { forwardRef, type ButtonHTMLAttributes } from "react";

// Zen 规格按钮：8px 圆角、字重 500、按下 scale(0.98)、时长 0.15s
// （zen-buttons.css: `transition: 0.1s` / `xul|button:active { transform: scale(0.98) }`）。
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "dangerSolid";

const VARIANTS: Record<ButtonVariant, string> = {
  // 实底 + 白字（对比度修正保证 AA）；悬停往深走一点，不往浅走（浅了白字就不够清楚）
  primary: "bg-[var(--accent-solid)] text-white hover:brightness-95",
  secondary:
    "border border-[color:var(--border-strong)] text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]",
  ghost:
    "text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]",
  danger: "text-[color:var(--danger)] hover:bg-[var(--fill-hover)]",
  dangerSolid: "bg-[var(--danger-solid)] text-white hover:brightness-95",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }>(
  function Button({ variant = "secondary", className = "", type = "button", ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        {...rest}
        className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--r-control)] px-3 py-1.5 text-sm font-medium transition-all duration-[var(--dur-md)] ease-in-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
      />
    );
  },
);
