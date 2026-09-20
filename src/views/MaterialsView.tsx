import { ViewShell } from "../components/layout/ViewShell";
import { MaterialsWorkspace } from "../components/materials/MaterialsWorkspace";

// 素材库一级视图（M4）：全局素材（不分书）。
// 注册于 registry（Ribbon 一级导航），主体是 MaterialsWorkspace。
export function MaterialsView() {
  return (
    <ViewShell title="素材库">
      <MaterialsWorkspace />
    </ViewShell>
  );
}
