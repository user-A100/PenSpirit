import { ViewShell } from "../components/layout/ViewShell";
import { StatsPanel } from "../components/stats/StatsPanel";

// 统计一级视图（M4）：原 write dock 的 stats tab 升级。
// 全宽后热力图/趋势条更舒展；口径注释见 StatsPanel 头。
export function StatsView() {
  return (
    <ViewShell title="写作统计">
      <StatsPanel />
    </ViewShell>
  );
}
