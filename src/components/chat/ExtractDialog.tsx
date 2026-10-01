import { useState } from "react";
import { Modal } from "../ui/Modal";
import { createCards, EXTRACT_LABEL, itemTitle, type ExtractItem, type ExtractKind } from "../../lib/ai/extract";
import { toast } from "../../stores/toast";

// 抽取结果确认（阶段 2B）：AI 给出的候选逐条勾选，可改名后再落成卡片。
export function ExtractDialog({ kind, items, onClose }: { kind: ExtractKind; items: ExtractItem[]; onClose: () => void }) {
  const [rows, setRows] = useState(items.map((it) => ({ it, on: true })));
  const [busy, setBusy] = useState(false);
  const key = kind === "character" ? "name" : kind === "foreshadow" ? "title" : "content";
  const picked = rows.filter((r) => r.on);
  return (
    <Modal open title={`抽取为${EXTRACT_LABEL[kind]}`} onClose={onClose}>
      <div className="space-y-1.5" data-testid="extract-dialog">
        {rows.length === 0 && <div className="text-xs text-[color:var(--text-faint)]">没抽到可用的条目</div>}
        {rows.map((r, i) => (
          <label key={i} className="flex items-start gap-2 rounded-[var(--r-control)] border border-[color:var(--hairline)] px-2 py-1.5 text-xs">
            <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <input
                value={itemTitle(kind, r.it)}
                aria-label="条目名"
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, it: { ...x.it, [key]: e.target.value } } : x)))}
                className="w-full bg-transparent font-medium text-[color:var(--text-primary)] outline-none"
              />
              <span className="block text-[color:var(--text-faint)]">
                {kind === "character" ? [r.it.role, r.it.aliases && `别名：${r.it.aliases}`, r.it.description].filter(Boolean).join(" · ") : kind === "foreshadow" ? r.it.note : ""}
              </span>
            </span>
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="rounded-[var(--r-control)] px-3 py-1.5 text-xs text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)]">
            取消
          </button>
          <button
            disabled={busy || picked.length === 0}
            onClick={async () => {
              setBusy(true);
              const n = await createCards(kind, picked.map((r) => r.it));
              setBusy(false);
              if (n > 0) toast.success(`已创建 ${n} 张${EXTRACT_LABEL[kind]}`);
              onClose();
            }}
            className="rounded-[var(--r-control)] bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
          >
            创建 {picked.length} 张
          </button>
        </div>
      </div>
    </Modal>
  );
}
