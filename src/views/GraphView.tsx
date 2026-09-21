import { useEffect, useState } from "react";
import { ViewShell } from "../components/layout/ViewShell";
import { FamilyTreeView } from "../components/graph/FamilyTreeView";
import { RelationNetworkView } from "../components/graph/RelationNetworkView";
import { MapView } from "../components/graph/MapView";
import { useCharacters } from "../stores/characters";
import { useRelations } from "../stores/relations";
import { useWorkspace } from "../stores/workspace";

// 一级视图「图谱」（M5）：家族树 / 关系网络 / 地图 三区块。
// 角色与关系在进入视图时随当前书加载，两份 list 供三区块共用。

const TABS = [
  { id: "tree", label: "家族树" },
  { id: "network", label: "关系网络" },
  { id: "map", label: "地图" },
] as const;
type GraphTab = (typeof TABS)[number]["id"];

export function GraphView() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const loadChars = useCharacters((s) => s.load);
  const loadRels = useRelations((s) => s.load);
  const [tab, setTab] = useState<GraphTab>("tree");

  useEffect(() => {
    void loadChars(currentBookId);
    void loadRels(currentBookId);
  }, [currentBookId, loadChars, loadRels]);

  return (
    <ViewShell title="图谱" wide>
      <div className="flex h-full flex-col">
        <div className="flex shrink-0 border-b border-[color:var(--border-subtle)]">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-testid={`graph-tab-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-[var(--dur-md)] ${
                tab === t.id
                  ? "border-[color:var(--accent)] text-[color:var(--text-primary)]"
                  : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 pt-3">
          {currentBookId == null ? (
            <div className="flex h-full items-center justify-center text-xs text-[color:var(--text-faint)]">
              请先选择书籍
            </div>
          ) : tab === "tree" ? (
            <FamilyTreeView />
          ) : tab === "network" ? (
            <RelationNetworkView />
          ) : (
            <MapView />
          )}
        </div>
      </div>
    </ViewShell>
  );
}
