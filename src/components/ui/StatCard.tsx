import type { LucideIcon } from "lucide-react";

// 指标小卡（M3-T9）：label / value / sub 三层，数字用 tabular-nums 对齐。
export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] text-[color:var(--text-faint)]">
        {Icon && <Icon size={12} className="shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-base font-semibold leading-tight tabular-nums text-[color:var(--text-primary)]">
        {value}
      </div>
      {sub !== undefined && (
        <div className="text-[11px] leading-snug text-[color:var(--text-faint)]">{sub}</div>
      )}
    </div>
  );
}
