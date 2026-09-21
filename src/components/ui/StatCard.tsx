import type { LucideIcon } from "lucide-react";

// 指标小卡（M3-T9；M6 卡片改版升档）：label / value / sub 三层，数字 tabular-nums。
// 尺寸 px-2.5 py-2 → p-3；label 11px→12px；value 16→18px；图标 12→14（kindling 字号律）。
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
    <div className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-3">
      <div className="flex items-center gap-1.5 text-xs text-[color:var(--text-faint)]">
        {Icon && <Icon size={14} className="shrink-0" aria-hidden />}
        <span className="truncate">{label}</span>
      </div>
      <div className="text-lg font-semibold leading-tight tabular-nums text-[color:var(--text-primary)]">
        {value}
      </div>
      {sub !== undefined && (
        <div className="text-xs leading-snug text-[color:var(--text-faint)]">{sub}</div>
      )}
    </div>
  );
}
