import { useState } from "react";
import type { CharacterRelation } from "../../lib/tauri";
import { useCharacters } from "../../stores/characters";
import { useRelations } from "../../stores/relations";
import { usePanZoom } from "../../hooks/usePanZoom";
import { RelationEditModal } from "./RelationEditModal";
import { edgeColor } from "./relationColors";

// 关系网络（M5-T4）：全角色圆周排布 + 关系直线边（语义色），点节点建关系、
// 点边编辑。手绘 SVG 足够——力导向布局留给未来（ponytail: 需要 d3-force 再上）。

const W = 1000;
const H = 640;
const CX = W / 2;
const CY = H / 2;

export function RelationNetworkView() {
  const chars = useCharacters((s) => s.list);
  const rels = useRelations((s) => s.list);
  const pz = usePanZoom();
  const [modal, setModal] = useState<{ sourceId: number | null; editing: CharacterRelation | null } | null>(null);

  // 圆周布局；角色 >60 时会开始拥挤（ponytail: 届时换双环或力导）
  const R = Math.min(CX, CY) - 70;
  const pos = new Map<number, { x: number; y: number }>();
  chars.forEach((c, i) => {
    const a = (i / Math.max(chars.length, 1)) * Math.PI * 2 - Math.PI / 2;
    pos.set(c.id, { x: CX + R * Math.cos(a), y: CY + R * Math.sin(a) });
  });

  if (chars.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-[color:var(--text-faint)]">
        还没有人物卡——先在写作视图的人物面板登记人物
      </div>
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={pz.ref}
        data-testid="network-canvas"
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
          <svg width={W} height={H} className="block">
            {rels.map((r, i) => {
              const a = pos.get(r.source_id);
              const b = pos.get(r.target_id);
              if (!a || !b) return null;
              // 方向对存两行时（A父母B + B子女A）两条线重叠，标签错开 t 避免叠字
              const t = i % 2 === 0 ? 0.46 : 0.56;
              const mx = a.x + (b.x - a.x) * t;
              const my = a.y + (b.y - a.y) * t;
              const color = edgeColor(r.relation_type);
              return (
                <g key={r.id} data-testid={`rel-edge-${r.id}`} onClick={() => setModal({ sourceId: null, editing: r })} className="cursor-pointer">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={1.5} opacity={0.75} />
                  <text
                    x={mx}
                    y={my}
                    textAnchor="middle"
                    fontSize={11}
                    fill={color}
                    stroke="var(--bg-elevated)"
                    strokeWidth={3}
                    style={{ paintOrder: "stroke" }}
                  >
                    {r.relation_type}
                  </text>
                  <title>{r.note || r.relation_type}</title>
                </g>
              );
            })}
            {chars.map((c) => {
              const p = pos.get(c.id)!;
              return (
                <g
                  key={c.id}
                  data-testid={`rel-node-${c.id}`}
                  onClick={() => setModal({ sourceId: c.id, editing: null })}
                  className="cursor-pointer"
                >
                  <circle cx={p.x} cy={p.y} r={30} fill="var(--bg-panel)" stroke="var(--border-strong)" strokeWidth={1.5} />
                  <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize={13} fill="var(--text-primary)">
                    {c.name}
                  </text>
                  <title>{c.role || c.name}</title>
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      <button
        onClick={pz.reset}
        title="复位视图"
        className="absolute right-3 top-3 rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2.5 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        复位
      </button>
      {rels.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-[color:var(--text-faint)]">
          点选角色建立第一段关系；滚轮缩放，拖拽平移
        </div>
      )}

      <RelationEditModal
        open={modal != null}
        onClose={() => setModal(null)}
        sourceId={modal?.sourceId ?? null}
        editing={modal?.editing ?? null}
      />
    </div>
  );
}
