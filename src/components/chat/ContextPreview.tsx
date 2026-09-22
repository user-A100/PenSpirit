import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Layers, Settings2 } from "lucide-react";
import type { AssemblyLog, ContextConfig, Idea, PlotBlock, SlotConfig } from "../../lib/tauri";
import { api } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

const SLOT_ROWS: { key: keyof ContextConfig; label: string }[] = [
  { key: "characters", label: "角色卡" },
  { key: "foreshadows", label: "伏笔提醒" },
  { key: "plots", label: "情节块" },
  { key: "ideas", label: "灵感卡" },
];

// 上下文预览：把「本次续写注入了哪些槽位」摊开给用户看（规格 §4.4：黑盒注入视为缺陷）。
// log 为 null 时空态；loading 只影响空态文案，已有结果时保持旧结果不闪。
// 注入设置：每书配置（开关 + 预算 + 情节块/灵感卡勾选），改动即存并触发 onConfigChanged。
export function ContextPreview({
  log,
  loading,
  onConfigChanged,
}: {
  log: AssemblyLog | null;
  loading: boolean;
  onConfigChanged?: () => void;
}) {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const [cfgOpen, setCfgOpen] = useState(false);
  const [cfg, setCfg] = useState<ContextConfig | null>(null);
  const [plots, setPlots] = useState<PlotBlock[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);

  // 展开时拉一次配置与可勾选素材；换书后重新拉
  useEffect(() => {
    if (!cfgOpen || currentBookId == null) return;
    setCfg(null);
    void api.contextConfigGet(currentBookId).then(setCfg).catch(() => setCfg(null));
    void api.plotBlocksList(currentBookId).then(setPlots).catch(() => setPlots([]));
    void api.ideasList().then(setIdeas).catch(() => setIdeas([]));
  }, [cfgOpen, currentBookId]);

  const patch = (key: keyof ContextConfig, next: SlotConfig) => {
    if (cfg == null || currentBookId == null) return;
    const updated: ContextConfig = { ...cfg, [key]: next };
    setCfg(updated);
    void api
      .contextConfigSet(currentBookId, updated)
      .then(() => onConfigChanged?.())
      .catch(() => {});
  };

  const toggleIds = (slot: SlotConfig, id: number, pool: { id: number }[]): SlotConfig => {
    // 全部态（ids=null）下点单项 → 先收窄为「全集去它」；勾选态下点单项 → 增删
    const base = slot.ids == null ? pool.map((p) => p.id) : slot.ids;
    const ids = base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
    return { ...slot, ids: ids.length === 0 ? null : ids };
  };

  return (
    <div className="flex h-full flex-col">
      {/* 注入设置：每书四槽位开关 + 预算 + 勾选 */}
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-3 py-1.5">
        <button
          onClick={() => setCfgOpen((v) => !v)}
          title="注入设置"
          className="flex w-full items-center gap-1.5 rounded px-0.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          {cfgOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          <Settings2 size={12} />
          <span>注入设置</span>
        </button>
        {cfgOpen && (
          <div className="mt-1 space-y-1.5 pb-1">
            {currentBookId == null || cfg == null ? (
              <div className="px-0.5 text-xs text-[color:var(--text-faint)]">加载中…</div>
            ) : (
              SLOT_ROWS.map(({ key, label }) => {
                const slot = cfg[key];
                const items: { id: number; label: string }[] =
                  key === "plots"
                    ? plots.map((p) => ({ id: p.id, label: p.content }))
                    : key === "ideas"
                      ? ideas.map((i) => ({ id: i.id, label: i.content }))
                      : [];
                return (
                  <div key={key} className="text-xs">
                    <div className="flex items-center gap-2">
                      <label className="flex shrink-0 cursor-pointer items-center gap-1">
                        <input
                          type="checkbox"
                          checked={slot.enabled}
                          onChange={(e) => patch(key, { ...slot, enabled: e.target.checked })}
                          data-testid={`inj-toggle-${key}`}
                        />
                        <span className="text-[color:var(--text-primary)]">{label}</span>
                      </label>
                      <span className="min-w-0 flex-1" />
                      <label className="flex shrink-0 items-center gap-1 text-[color:var(--text-faint)]">
                        预算
                        <input
                          type="number"
                          min={0}
                          value={slot.budget}
                          onChange={(e) =>
                            patch(key, { ...slot, budget: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
                          }
                          data-testid={`inj-budget-${key}`}
                          className="w-14 rounded border border-[color:var(--border-subtle)] bg-transparent px-1 py-0.5 text-right text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
                        />
                        字
                      </label>
                    </div>
                    {(key === "plots" || key === "ideas") && slot.enabled && items.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1 pl-5" data-testid={`inj-items-${key}`}>
                        <label className="flex cursor-pointer items-center gap-1 rounded border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[color:var(--text-secondary)]">
                          <input
                            type="checkbox"
                            checked={slot.ids == null}
                            onChange={(e) => patch(key, { ...slot, ids: e.target.checked ? null : [] })}
                            data-testid={`inj-all-${key}`}
                          />
                          全部
                        </label>
                        {items.map((it) => (
                          <label
                            key={it.id}
                            title={it.label}
                            className="flex max-w-40 cursor-pointer items-center gap-1 rounded border border-[color:var(--border-subtle)] px-1.5 py-0.5 text-[color:var(--text-secondary)]"
                          >
                            <input
                              type="checkbox"
                              checked={slot.ids == null || slot.ids.includes(it.id)}
                              onChange={() => patch(key, toggleIds(slot, it.id, items))}
                              data-testid={`inj-item-${key}-${it.id}`}
                            />
                            <span className="truncate">{it.label}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {log == null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 text-center">
          <Layers size={28} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
          <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
            {loading ? "正在组装上下文…" : "点击刷新查看本次续写的上下文组装"}
          </div>
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 pt-2 text-xs text-[color:var(--text-secondary)]">
            共 {log.slots.length} 个槽位 · 估算 {log.total_est_tokens} tokens
          </div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
            {log.slots.map((s, i) => (
              <div key={i} className="rounded-md border border-[color:var(--border-subtle)] p-2.5">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-xs font-medium text-[color:var(--text-primary)]">{s.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">{s.source}</span>
                  <span className="shrink-0 text-xs text-[color:var(--text-faint)]">
                    {s.chars} 字 / ~{s.est_tokens} tokens
                  </span>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap rounded bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-xs leading-relaxed text-[color:var(--text-secondary)]">
                  {s.preview_head}
                </pre>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
