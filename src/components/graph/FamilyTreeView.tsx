import { useMemo, useState } from "react";
import type { CharacterRelation } from "../../lib/tauri";
import { useCharacters } from "../../stores/characters";
import { useRelations } from "../../stores/relations";
import { usePanZoom } from "../../hooks/usePanZoom";
import { Badge } from "../ui/Badge";
import { RelationEditModal } from "./RelationEditModal";
import { NODE_H, NODE_W, layoutFamilyTree } from "./familyTree";

// 家族树（M5-T5）：familyTree.ts 纯函数布局 + pan/zoom 渲染。
// 血亲边走 --border-strong，配偶边走 --accent；成环角色顶部黄 Badge 警示。

export function FamilyTreeView() {
  const chars = useCharacters((s) => s.list);
  const rels = useRelations((s) => s.list);
  const pz = usePanZoom();
  const [modal, setModal] = useState<{ sourceId: number | null; editing: CharacterRelation | null } | null>(null);

  const layout = useMemo(() => layoutFamilyTree(chars, rels), [chars, rels]);

  if (chars.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[color:var(--text-faint)]">
        还没有人物卡——先在写作视图的人物面板登记人物
      </div>
    );
  }

  // 未入谱行：布局函数把它们放在同一 y（最大世代 +1 层）
  const strayY = layout.strayIds.length
    ? layout.nodes.find((n) => layout.strayIds.includes(n.char.id))?.y
    : undefined;

  return (
    <div className="relative h-full">
      <div
        ref={pz.ref}
        data-testid="tree-canvas"
        className="h-full cursor-grab overflow-hidden rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)]"
        onPointerDown={pz.onPointerDown}
        onPointerMove={pz.onPointerMove}
        onPointerUp={pz.onPointerUp}
        onPointerLeave={pz.onPointerLeave}
      >
        <div
          className="flex h-full items-center justify-center"
          style={{ transform: `translate(${pz.t.x}px, ${pz.t.y}px) scale(${pz.t.k})`, transformOrigin: "0 0" }}
        >
          <svg width={layout.width} height={layout.height} className="block">
            {layout.edges.map((e, i) => (
              <line
                key={i}
                x1={e.x1}
                y1={e.y1}
                x2={e.x2}
                y2={e.y2}
                stroke={e.kind === "spouse" ? "var(--accent)" : "var(--border-strong)"}
                strokeWidth={e.kind === "spouse" ? 2 : 1.5}
                opacity={0.8}
              />
            ))}
            {strayY != null && (
              <text x={16} y={strayY + NODE_H / 2 + 4} fontSize={11} fill="var(--text-faint)">
                未入谱
              </text>
            )}
            {layout.nodes.map((n) => (
              <g
                key={n.char.id}
                data-testid={`tree-node-${n.char.id}`}
                onClick={() => setModal({ sourceId: n.char.id, editing: null })}
                className="cursor-pointer"
                opacity={layout.strayIds.includes(n.char.id) ? 0.55 : 1}
              >
                <rect
                  x={n.x}
                  y={n.y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  fill="var(--bg-panel)"
                  stroke={layout.strayIds.includes(n.char.id) ? "var(--border-subtle)" : "var(--border-strong)"}
                  strokeWidth={1.5}
                />
                <text x={n.x + NODE_W / 2} y={n.y + NODE_H / 2 + 4.5} textAnchor="middle" fontSize={13} fill="var(--text-primary)">
                  {n.char.name}
                </text>
                <title>{n.char.role || n.char.name}</title>
              </g>
            ))}
          </svg>
        </div>
      </div>

      {layout.islandIds.length > 0 && (
        <div className="absolute left-3 top-3" data-testid="tree-island-warning">
          <Badge tone="amber" title="这些角色互为血亲形成环路，无法排入谱系，已放在底部孤岛行">
            谱系成环 {layout.islandIds.length} 人
          </Badge>
        </div>
      )}
      <button
        onClick={pz.reset}
        title="复位视图"
        className="absolute right-3 top-3 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        复位
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-[color:var(--text-faint)]">
        紫线=配偶 灰线=血亲；点角色建立关系；滚轮缩放，拖拽平移
      </div>

      <RelationEditModal
        open={modal != null}
        onClose={() => setModal(null)}
        sourceId={modal?.sourceId ?? null}
        editing={modal?.editing ?? null}
      />
    </div>
  );
}
