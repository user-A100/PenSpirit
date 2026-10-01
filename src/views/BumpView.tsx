import { ViewShell } from "../components/layout/ViewShell";
import { BumpWorkspace } from "./bump/BumpWorkspace";

// 碰碰车一级视图（M2-T10 填充工作区；阶段 1 入统一视图壳）
export function BumpView() {
  return (
    <ViewShell title="碰碰车" subtitle="把不相干的词撞在一起" wide>
      <BumpWorkspace />
    </ViewShell>
  );
}
