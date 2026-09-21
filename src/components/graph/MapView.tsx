import { useEffect, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { convertFileSrc } from "@tauri-apps/api/core";
import { MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import type { Place, PlaceInput } from "../../lib/tauri";
import { useCharacters } from "../../stores/characters";
import { useMaps } from "../../stores/maps";
import { useWorkspace } from "../../stores/workspace";
import { usePanZoom } from "../../hooks/usePanZoom";
import { Button } from "../ui/Button";
import { Input, inputClass } from "../ui/Input";
import { Modal } from "../ui/Modal";

// 世界地图（M5-T6）：左列地图清单 + 右侧 pan/zoom 底图画布。
// pin 用百分比坐标直接叠在图上（换图/缩放不失效）；双击图面落新 pin，
// 拖动 pin 松手即 placeUpsert，点 pin 开详情卡。地图文件走 asset 协议直读。

const clampPct = (v: number) => Math.min(100, Math.max(0, v));
const basename = (p: string) => {
  const f = p.split(/[\\/]/).pop() ?? p;
  const dot = f.lastIndexOf(".");
  return dot > 0 ? f.slice(0, dot) : f;
};

/** pin 详情/新建弹窗（仅地图使用，不独立成文件） */
function PlaceModal(props: {
  open: boolean;
  initial: Place | null;
  defaultXY: { x: number; y: number } | null;
  onClose: () => void;
  onSave: (input: PlaceInput) => void;
  onDelete: (id: number) => void;
}) {
  const chars = useCharacters((s) => s.list);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [linked, setLinked] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!props.open) return;
    setName(props.initial?.name ?? "");
    setDesc(props.initial?.description ?? "");
    setLinked(
      new Set(
        (props.initial?.linked_character_ids ?? "")
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isInteger(n) && n > 0),
      ),
    );
  }, [props.open, props.initial]);

  const save = () => {
    const n = name.trim();
    if (!n) return;
    props.onSave({
      id: props.initial?.id ?? null,
      map_id: props.initial?.map_id ?? 0,
      name: n,
      description: desc.trim(),
      linked_character_ids: [...linked].sort((a, b) => a - b).join(","),
      x: props.initial?.x ?? props.defaultXY?.x ?? 50,
      y: props.initial?.y ?? props.defaultXY?.y ?? 50,
    });
  };

  return (
    <Modal
      open={props.open}
      onClose={props.onClose}
      title={props.initial ? `地点 · ${props.initial.name}` : "新地点"}
      widthClass="max-w-md"
      testId="place-modal"
      footer={
        <div className="flex items-center justify-between border-t border-[color:var(--border-subtle)] px-4 py-3">
          {props.initial ? (
            <Button
              variant="danger"
              data-testid="place-delete"
              onClick={() => props.initial && props.onDelete(props.initial.id)}
            >
              删除
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={props.onClose}>
              取消
            </Button>
            <Button variant="primary" data-testid="place-save" disabled={!name.trim()} onClick={save}>
              保存
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-3 px-4 py-4">
        <div>
          <label className="mb-1 block text-xs text-[color:var(--text-secondary)]">名称</label>
          <Input
            data-testid="place-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="如：落霞镇"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-[color:var(--text-secondary)]">描述</label>
          <textarea
            data-testid="place-desc"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            rows={3}
            placeholder="风物、势力、发生过的关键情节……"
            className={`${inputClass} resize-none`}
          />
        </div>
        {chars.length > 0 && (
          <div>
            <label className="mb-1 block text-xs text-[color:var(--text-secondary)]">关联角色</label>
            <div className="flex flex-wrap gap-1.5">
              {chars.map((c) => {
                const on = linked.has(c.id);
                return (
                  <button
                    key={c.id}
                    data-testid={`place-linked-${c.id}`}
                    onClick={() =>
                      setLinked((prev) => {
                        const next = new Set(prev);
                        if (next.has(c.id)) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors duration-[var(--dur-md)] ${
                      on
                        ? "border-[color:var(--accent)] bg-[var(--accent-dim)] text-[color:var(--accent)]"
                        : "border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MapView() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const maps = useMaps((s) => s.maps);
  const activeMapId = useMaps((s) => s.activeMapId);
  const places = useMaps((s) => s.places);
  const load = useMaps((s) => s.load);
  const select = useMaps((s) => s.select);
  const importMap = useMaps((s) => s.importMap);
  const rename = useMaps((s) => s.rename);
  const removeMap = useMaps((s) => s.removeMap);
  const placeUpsert = useMaps((s) => s.placeUpsert);
  const placeRemove = useMaps((s) => s.placeRemove);

  // 挂载时随当前书拉取地图列表（无书时 GraphView 已落空态，这里 load(null) 清空即可）
  useEffect(() => {
    void load(currentBookId);
  }, [currentBookId, load]);

  const pz = usePanZoom();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [editor, setEditor] = useState<{ initial: Place | null; xy: { x: number; y: number } | null } | null>(null);
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [drag, setDrag] = useState<{ id: number; x: number; y: number } | null>(null);
  const dragMoved = useRef(false);

  const activeMap = maps.find((m) => m.id === activeMapId) ?? null;

  const pickImage = async () => {
    const picked = await openFileDialog({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (typeof picked !== "string" || picked.length === 0) return;
    await importMap(basename(picked), picked);
  };

  const pctOf = (e: { clientX: number; clientY: number }) => {
    const r = surfaceRef.current!.getBoundingClientRect();
    return { x: clampPct(((e.clientX - r.left) / r.width) * 100), y: clampPct(((e.clientY - r.top) / r.height) * 100) };
  };

  const saveEditor = (input: PlaceInput) => {
    void placeUpsert({ ...input, map_id: activeMapId ?? 0 });
    setEditor(null);
  };

  if (maps.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-[color:var(--text-faint)]">
        <MapPin size={28} />
        <span>还没有世界地图——导入一张图片开始圈地</span>
        <Button variant="secondary" data-testid="map-import" onClick={() => void pickImage()}>
          <Plus size={14} /> 导入地图
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full gap-3">
      {/* 地图清单 */}
      <div className="flex w-44 shrink-0 flex-col rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-panel)]">
        <div className="flex items-center justify-between px-3 py-2.5">
          <span className="text-xs font-semibold text-[color:var(--text-secondary)]">地图</span>
          <button
            data-testid="map-import"
            title="导入地图"
            onClick={() => void pickImage()}
            className="rounded-[var(--radius-md)] p-1 text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5">
          {maps.map((m) => (
            <div
              key={m.id}
              data-testid={`map-item-${m.id}`}
              className={`group flex items-center gap-1 rounded-[var(--radius-md)] px-2 py-1.5 text-sm transition-colors duration-[var(--dur-md)] ${
                m.id === activeMapId
                  ? "bg-[var(--bg-hover)] text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              }`}
            >
              <button className="min-w-0 flex-1 truncate text-left" onClick={() => void select(m.id)} title={m.name}>
                {m.name}
              </button>
              <button
                data-testid={`map-rename-${m.id}`}
                title="重命名"
                onClick={() => setRenaming({ id: m.id, name: m.name })}
                className="hidden shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:text-[color:var(--text-primary)] group-hover:block"
              >
                <Pencil size={12} />
              </button>
              <button
                data-testid={`map-delete-${m.id}`}
                title="删除地图"
                onClick={() => {
                  if (window.confirm(`删除地图「${m.name}」及其全部地点？`)) void removeMap(m.id);
                }}
                className="hidden shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:text-[color:var(--danger)] group-hover:block"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* 画布 */}
      <div className="relative min-w-0 flex-1">
        <div
          ref={pz.ref}
          data-testid="map-canvas"
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
            <div
              ref={surfaceRef}
              data-testid="map-surface"
              className="relative"
              onDoubleClick={(e) => setEditor({ initial: null, xy: pctOf(e) })}
            >
              {activeMap && (
                <img
                  src={convertFileSrc(activeMap.path)}
                  alt={activeMap.name}
                  draggable={false}
                  className="block max-h-[68vh] max-w-[60vw] select-none"
                />
              )}
              {places.map((p) => {
                const pos = drag?.id === p.id ? drag : p;
                return (
                  <button
                    key={p.id}
                    data-testid={`map-pin-${p.id}`}
                    title={p.name}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-pointer flex-col items-center"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.currentTarget.setPointerCapture?.(e.pointerId);
                      dragMoved.current = false;
                      setDrag({ id: p.id, x: p.x, y: p.y });
                    }}
                    onPointerMove={(e) => {
                      if (drag?.id !== p.id) return;
                      const start = { x: p.x, y: p.y };
                      const next = pctOf(e);
                      if (Math.abs(next.x - start.x) > 0.5 || Math.abs(next.y - start.y) > 0.5) dragMoved.current = true;
                      setDrag({ id: p.id, ...next });
                    }}
                    onPointerUp={() => {
                      if (drag?.id !== p.id) return;
                      if (dragMoved.current) {
                        void placeUpsert({
                          id: p.id,
                          map_id: p.map_id,
                          name: p.name,
                          description: p.description,
                          linked_character_ids: p.linked_character_ids,
                          x: drag.x,
                          y: drag.y,
                        });
                      } else {
                        setEditor({ initial: p, xy: null });
                      }
                      setDrag(null);
                    }}
                  >
                    <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[color:var(--border-strong)] bg-[var(--bg-panel)] text-[color:var(--accent)] [box-shadow:var(--shadow-pop)]">
                      <MapPin size={13} />
                    </span>
                    <span
                      className="mt-0.5 max-w-24 truncate rounded px-1 text-[11px] text-[color:var(--text-primary)]"
                      style={{ background: "color-mix(in srgb, var(--bg-panel) 78%, transparent)" }}
                    >
                      {p.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-xs text-[color:var(--text-faint)]">
          双击图面落地点，拖动 pin 调整位置；滚轮缩放，拖拽平移
        </div>
        {activeMapId == null && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[color:var(--text-faint)]">
            在左侧选择一张地图
          </div>
        )}
      </div>

      <PlaceModal
        open={editor != null}
        initial={editor?.initial ?? null}
        defaultXY={editor?.xy ?? null}
        onClose={() => setEditor(null)}
        onSave={saveEditor}
        onDelete={(id) => {
          void placeRemove(id);
          setEditor(null);
        }}
      />

      <Modal
        open={renaming != null}
        onClose={() => setRenaming(null)}
        title="重命名地图"
        widthClass="max-w-sm"
        testId="map-rename-modal"
        footer={
          <div className="flex justify-end gap-2 border-t border-[color:var(--border-subtle)] px-4 py-3">
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              data-testid="map-rename-save"
              disabled={!renaming?.name.trim()}
              onClick={() => {
                if (renaming) void rename(renaming.id, renaming.name.trim());
                setRenaming(null);
              }}
            >
              保存
            </Button>
          </div>
        }
      >
        <div className="px-4 py-4">
          <Input
            data-testid="map-rename-input"
            value={renaming?.name ?? ""}
            onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
          />
        </div>
      </Modal>
    </div>
  );
}
