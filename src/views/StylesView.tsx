import { ViewShell } from "../components/layout/ViewShell";
import { StylePanel } from "../components/styles/StylePanel";

// 文风库一级视图（M4）：原 write dock 的 styles tab 升级。
// StylePanel 内部自适应宽度（h-full flex-col + 内滚动），直接入壳。
export function StylesView() {
  return (
    <ViewShell title="文风库">
      <StylePanel />
    </ViewShell>
  );
}
