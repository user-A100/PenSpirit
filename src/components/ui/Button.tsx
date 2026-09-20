import type { ButtonHTMLAttributes } from "react";

// Zen 规格按钮：8px 圆角、字重 500、按下 scale(0.98)、时长 0.15s
// （zen-buttons.css: `transition: 0.1s` / `xul|button:active { transform: scale(0.98) }`）。
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]",
  secondary:
    "border border-[color:var(--border-strong)] text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]",
  ghost:
    "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]",
  danger: "text-[color:var(--danger)] hover:bg-[var(--bg-hover)]",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-all duration-[var(--dur-md)] ease-in-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ${VARIANTS[variant]} ${className}`}
    />
  );
}
