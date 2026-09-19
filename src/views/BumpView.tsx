import { CircleDot } from "lucide-react";

// 碰碰车一级视图——M2-T1 占位，T10 填充工作区
export function BumpView() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)] px-6 text-center">
      <CircleDot size={48} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
      <div className="text-base text-[color:var(--text-secondary)]">碰碰车</div>
      <div className="text-sm text-[color:var(--text-faint)]">灵感碰撞器即将开放</div>
    </div>
  );
}
