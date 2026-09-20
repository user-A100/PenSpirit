import type { InputHTMLAttributes } from "react";

// 统一输入框外观：bg-elevated 底、8px 圆角、focus 边框转 accent。
// 需要自绘外壳（如无边框搜索框）时直接引用 inputClass 再覆盖。
export const inputClass =
  "w-full rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-[var(--dur-md)] placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

export function Input({
  className = "",
  invalid,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...rest}
      className={`${inputClass} ${invalid ? "border-[color:var(--danger)]" : ""} ${className}`}
    />
  );
}
