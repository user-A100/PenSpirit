import { useEffect, useState } from "react";
import type { CharacterRelation } from "../../lib/tauri";
import { useCharacters } from "../../stores/characters";
import { useRelations } from "../../stores/relations";
import { useWorkspace } from "../../stores/workspace";
import { RELATION_PRESETS } from "./relationColors";
import { Modal } from "../ui/Modal";

// 关系编辑弹窗（M5-T4）：sourceId 固定的发起方 + 对方下拉 + 类型（预设 chips
// 或自由填写）+ 备注；editing 有值 = 编辑该条（可删）。双方共用同一表单。
export function RelationEditModal({
  open,
  onClose,
  sourceId,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  /** 新建时点选的发起方角色 id */
  sourceId: number | null;
  editing: CharacterRelation | null;
}) {
  const chars = useCharacters((s) => s.list);
  const upsert = useRelations((s) => s.upsert);
  const remove = useRelations((s) => s.remove);
  const currentBookId = useWorkspace((s) => s.currentBookId);

  const [targetId, setTargetId] = useState<number | null>(null);
  const [type, setType] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetId(null);
    setType(editing?.relation_type ?? "");
    setNote(editing?.note ?? "");
    setError(null);
  }, [open, editing]);

  if (currentBookId == null) return null;

  const srcId = editing?.source_id ?? sourceId;
  const others = chars.filter((c) => c.id !== srcId);

  const save = async () => {
    if (srcId == null || targetId == null) {
      setError("请选择对方角色");
      return;
    }
    if (!type.trim()) {
      setError("请填写关系类型");
      return;
    }
    const ok = await upsert({
      id: editing?.id ?? null,
      book_id: currentBookId,
      source_id: srcId,
      target_id: targetId,
      relation_type: type.trim(),
      note: note.trim(),
    });
    if (!ok) {
      setError("保存失败，请重试");
      return;
    }
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "编辑关系" : "新建关系"}
      widthClass="max-w-md"
      testId="relation-modal"
      footer={
        <div className="flex items-center gap-2 border-t border-[color:var(--border-subtle)] px-4 py-3">
          {editing && (
            <button
              data-testid="rel-delete"
              onClick={async () => {
                if (await remove(editing.id)) onClose();
              }}
              className="text-sm text-[color:var(--danger)] transition-colors duration-[var(--dur-md)] hover:opacity-80"
            >
              删除关系
            </button>
          )}
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            取消
          </button>
          <button
            data-testid="rel-save"
            onClick={() => void save()}
            className="rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-white transition-colors duration-[var(--dur-md)] hover:bg-[var(--accent-hover)]"
          >
            保存
          </button>
        </div>
      }
    >
      <div className="space-y-3 p-4">
        <div className="text-xs text-[color:var(--text-secondary)]">
          发起方：
          <span className="font-medium text-[color:var(--text-primary)]">
            {chars.find((c) => c.id === srcId)?.name ?? "?"}
          </span>
        </div>

        <select
          data-testid="rel-target"
          value={targetId ?? ""}
          onChange={(e) => setTargetId(e.target.value ? Number(e.target.value) : null)}
          className="w-full rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-[var(--dur-md)] focus:border-[color:var(--accent)]"
        >
          <option value="">对方角色…</option>
          {others.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.role ? `（${c.role}）` : ""}
            </option>
          ))}
        </select>

        <div>
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {RELATION_PRESETS.map((p) => (
              <button
                key={p}
                data-testid={`rel-preset-${p}`}
                onClick={() => setType(p)}
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors duration-[var(--dur-md)] ${
                  type === p
                    ? "border-[color:var(--accent)] bg-[var(--accent-dim)] text-[color:var(--accent)]"
                    : "border-[color:var(--border-subtle)] text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
          <input
            data-testid="rel-type-input"
            value={type}
            onChange={(e) => setType(e.target.value)}
            placeholder="关系类型：可点上方预设，也可自由填写"
            className="w-full rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-[var(--dur-md)] placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]"
          />
        </div>

        <textarea
          data-testid="rel-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="备注（可选）：认识缘由、当前状态…"
          rows={2}
          className="w-full resize-none rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-[var(--dur-md)] placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]"
        />

        {error && <div className="text-xs text-[color:var(--danger)]">{error}</div>}
      </div>
    </Modal>
  );
}
