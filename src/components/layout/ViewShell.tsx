import type { ReactNode } from "react";

// 一级视图壳（阶段 1 统一）：所有非写作视图同一套头部规范——
// 标题（15px 半粗）+ 可选副标题 + 右侧动作区；内容区自带滚动由子组件负责。
// wide：画布类视图（图谱/结构/碰碰车）吃满卡片；否则居中限宽 max-w-6xl，
// 子组件用 @container 查询按实际宽度切换单栏/多栏。
export function ViewShell({
  title,
  subtitle,
  actions,
  wide,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-transparent">
      <header className={`mx-auto flex h-14 w-full shrink-0 items-center gap-3 px-6 ${wide ? "" : "max-w-6xl"}`}>
        <h1 className="shrink-0 text-md font-semibold tracking-wide text-[color:var(--text-primary)]">{title}</h1>
        {subtitle && <span className="min-w-0 truncate text-xs text-[color:var(--text-faint)]">{subtitle}</span>}
        <div className="min-w-0 flex-1" />
        {actions}
      </header>
      <div className={`mx-auto min-h-0 w-full flex-1 px-6 pb-6 ${wide ? "" : "max-w-6xl"}`}>{children}</div>
    </div>
  );
}
