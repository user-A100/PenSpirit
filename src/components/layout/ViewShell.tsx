import type { ReactNode } from "react";

// 一级视图壳（M4）：标题 + 限宽居中内容区。
// dock 面板升级为一级视图时的统一容器——面板内部自带滚动，
// 这里只给页面骨架与最大宽度（阅读友好的 56rem）。
// wide（M5）：图谱/地图等画布类视图取消限宽，吃满卡片。
export function ViewShell({
  title,
  wide,
  children,
}: {
  title: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="h-full bg-transparent">
      <div className={`mx-auto h-full px-6 pb-6 pt-5 ${wide ? "" : "max-w-4xl"}`}>
        <h1 className="mb-4 shrink-0 text-base font-semibold tracking-wide text-[color:var(--text-primary)]">
          {title}
        </h1>
        <div className="h-[calc(100%-3rem)] min-h-0">{children}</div>
      </div>
    </div>
  );
}
