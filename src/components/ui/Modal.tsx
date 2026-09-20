import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

// 统一弹窗外壳：backdrop 点击关闭 + Esc 关闭 + Zen 浮卡面板
// （14px 圆角、单层阴影、下移 10px 淡入；zen-theme.css / zen-animations.css）。
// align="top" 用于搜索面板这类贴顶浮层。
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  align = "center",
  widthClass = "max-w-xl",
  maxHeightClass = "max-h-[85vh]",
  testId,
}: {
  open: boolean;
  onClose: () => void;
  /** 省略则不渲染标题栏（面板自带头部时用） */
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  align?: "center" | "top";
  widthClass?: string;
  maxHeightClass?: string;
  testId?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid={testId}
      className={`fixed inset-0 z-50 flex justify-center bg-black/50 ${
        align === "top" ? "items-start pt-20" : "items-center"
      }`}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "zen-pop-in var(--dur-md) ease-in-out" }}
        className={`flex w-full ${widthClass} ${maxHeightClass} flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] [box-shadow:var(--shadow-pop)]`}
      >
        {title !== undefined && (
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--border-subtle)] pl-4 pr-2">
            <div className="min-w-0 truncate text-sm font-semibold text-[color:var(--text-primary)]">{title}</div>
            <button
              onClick={onClose}
              title="关闭"
              className="rounded-[var(--radius-md)] p-1.5 text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <X size={15} />
            </button>
          </div>
        )}
        {children}
        {footer}
      </div>
    </div>
  );
}
