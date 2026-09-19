import { useEffect, useState } from "react";
import { Check, ChevronDown, Plug, Settings2 } from "lucide-react";
import { AgentDescriptor } from "../../lib/tauri";
import { useAgents } from "../../stores/agents";
import { useSettings } from "../../stores/settings";

// 状态点：探测通过绿 / 失败红 / 未探测灰
function statusColor(a: AgentDescriptor): string {
  if (a.last_probe?.ok) return "var(--success)";
  if (a.last_probe) return "var(--danger)";
  return "var(--text-faint)";
}

/**
 * AI Dock 顶栏的双后端选择器：enabled 的 agent（探测状态点 + 名称 + 默认徽章）
 * + 「API 直连（高级）」（M1 provider 路径）。未探测的 agent 灰点展示，
 * 选中未通过探测的 agent 时顺带触发一次探测刷新状态。选择即存 localStorage。
 */
export function BackendSelector() {
  const agents = useAgents((s) => s.agents);
  const backend = useAgents((s) => s.backend);
  const probing = useAgents((s) => s.probing);
  const load = useAgents((s) => s.load);
  const setBackend = useAgents((s) => s.setBackend);
  const probe = useAgents((s) => s.probe);
  const openSettings = useSettings((s) => s.open);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const enabled = agents.filter((a) => a.enabled);
  const current = backend?.startsWith("agent:")
    ? agents.find((a) => a.id === backend.slice("agent:".length))
    : undefined;

  const pick = async (value: string, agent?: AgentDescriptor) => {
    setOpen(false);
    await setBackend(value);
    // 手动探测兜底：选中未通过探测的 agent 时刷新一次状态
    if (agent && agent.last_probe?.ok !== true) void probe(agent.id);
  };

  return (
    <div className="relative min-w-0">
      <button
        onClick={() => setOpen((v) => !v)}
        title="切换 AI 后端（本机 agent 或 API 直连）"
        className="flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: current ? statusColor(current) : "var(--accent)" }}
        />
        <span className="max-w-28 truncate">
          {backend == null ? "后端…" : current ? current.name : "API 直连"}
        </span>
        <ChevronDown size={11} className={`shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          {/* 点击外部收起 */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 shadow-lg">
            {enabled.length === 0 && (
              <button
                onClick={() => {
                  setOpen(false);
                  openSettings();
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
              >
                <Settings2 size={13} className="shrink-0 text-[color:var(--warning)]" />
                去设置 Agent…
              </button>
            )}
            {enabled.map((a) => {
              const active = backend === `agent:${a.id}`;
              return (
                <button
                  key={a.id}
                  onClick={() => void pick(`agent:${a.id}`, a)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: statusColor(a) }} />
                  <span className={`min-w-0 flex-1 truncate text-xs ${active ? "text-[color:var(--accent)]" : "text-[color:var(--text-primary)]"}`}>
                    {a.name}
                  </span>
                  {probing.has(a.id) && (
                    <span className="shrink-0 animate-pulse text-[10px] text-[color:var(--text-faint)]">探测中</span>
                  )}
                  {a.is_default && !active && (
                    <span className="shrink-0 rounded-full bg-[var(--accent-dim)] px-1.5 py-0.5 text-[10px] text-[color:var(--accent)]">默认</span>
                  )}
                  {active && <Check size={12} className="shrink-0 text-[color:var(--accent)]" />}
                </button>
              );
            })}
            {enabled.length > 0 && (
              <>
                <div className="my-1 border-t border-[color:var(--border-subtle)]" />
                <button
                  onClick={() => void pick("provider")}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                >
                  <Plug size={12} className={`shrink-0 ${backend === "provider" ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"}`} />
                  <span className={`min-w-0 flex-1 truncate text-xs ${backend === "provider" ? "text-[color:var(--accent)]" : "text-[color:var(--text-primary)]"}`}>
                    API 直连（高级）
                  </span>
                  {backend === "provider" && <Check size={12} className="shrink-0 text-[color:var(--accent)]" />}
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
