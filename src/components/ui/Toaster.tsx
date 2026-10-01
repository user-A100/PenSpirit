import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { useToasts, type Toast } from "../../stores/toast";

const ICON = { info: Info, success: CheckCircle2, error: CircleAlert } as const;
const ICON_COLOR = {
  info: "text-[color:var(--accent)]",
  success: "text-[color:var(--success)]",
  error: "text-[color:var(--danger)]",
} as const;

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useToasts((s) => s.dismiss);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const remaining = useRef(t.duration);
  const startedAt = useRef(0);

  const close = () => {
    setLeaving(true);
    window.setTimeout(() => dismiss(t.id), 160); // 等退场动画
  };

  // 计时：悬停暂停，离开后按剩余时长继续
  useEffect(() => {
    if (t.duration === 0 || paused || leaving) return;
    startedAt.current = Date.now();
    const h = window.setTimeout(close, remaining.current);
    return () => {
      window.clearTimeout(h);
      remaining.current -= Date.now() - startedAt.current;
    };
    // close 只依赖 t.id，不放进依赖避免计时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, leaving, t.duration]);

  const Icon = ICON[t.kind];
  return (
    <div
      role={t.kind === "error" ? "alert" : "status"}
      data-testid="toast"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`pointer-events-auto flex min-h-10 w-[22rem] max-w-[calc(100vw-2rem)] items-center gap-2.5 rounded-[var(--radius-lg)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-2 pl-3 pr-1.5 text-ui text-[color:var(--text-primary)] [box-shadow:var(--shadow-overlay,0_10px_30px_rgba(0,0,0,0.3))] ${
        leaving ? "toast-out" : "toast-in"
      }`}
    >
      <Icon size={16} className={`shrink-0 ${ICON_COLOR[t.kind]}`} />
      <span className="min-w-0 flex-1 break-words leading-snug">{t.message}</span>
      {t.action && (
        <button
          onClick={() => {
            void Promise.resolve(t.action!.run()).finally(close);
          }}
          className="shrink-0 rounded-[var(--radius-sm)] px-2 py-1 text-ui font-medium text-[color:var(--accent)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)]"
        >
          {t.action.label}
        </button>
      )}
      <button
        onClick={close}
        title="关闭"
        aria-label="关闭提示"
        className="shrink-0 rounded-[var(--radius-sm)] p-1 text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
      >
        <X size={13} />
      </button>
    </div>
  );
}

/** 全局提示层：挂在 App 根部一次 */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed right-[calc(var(--sep)+0.5rem)] top-[calc(var(--sep)+0.5rem)] z-[300] flex flex-col items-end gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
