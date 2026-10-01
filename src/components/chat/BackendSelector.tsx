import { useEffect } from "react";
import { ChevronDown, Cpu, Plug, Settings2 } from "lucide-react";
import type { AgentDescriptor } from "../../lib/tauri";
import { useAgents } from "../../stores/agents";
import { useSettings } from "../../stores/settings";
import { openMenuAt, type MenuEntry } from "../../stores/menu";

// 状态点：探测通过绿 / 失败红 / 未探测灰
function statusColor(a: AgentDescriptor): string {
  if (a.last_probe?.ok) return "var(--success)";
  if (a.last_probe) return "var(--danger)";
  return "var(--text-faint)";
}

/**
 * AI 后端与模型快切（阶段 2A）：本机 agent（探测状态点）+ 已配置的 API 服务商
 * （「名称 · 模型」，选中即设为使用中）+ 管理入口。选择即存（agents store / settings）。
 */
export function BackendSelector() {
  const agents = useAgents((s) => s.agents);
  const backend = useAgents((s) => s.backend);
  const load = useAgents((s) => s.load);
  const setBackend = useAgents((s) => s.setBackend);
  const probe = useAgents((s) => s.probe);
  const providers = useSettings((s) => s.providers);
  const activeProviderId = useSettings((s) => s.activeProviderId);
  const loadProviders = useSettings((s) => s.load);
  const activate = useSettings((s) => s.activate);
  const openSettings = useSettings((s) => s.open);

  useEffect(() => {
    void load();
    void loadProviders();
  }, [load, loadProviders]);

  const enabled = agents.filter((a) => a.enabled);
  const current = backend?.startsWith("agent:") ? agents.find((a) => a.id === backend.slice("agent:".length)) : undefined;
  const provider = providers.find((p) => p.id === activeProviderId);
  const label = backend == null ? "后端…" : current ? current.name : provider ? provider.model || provider.name : "未配置服务商";

  const items = (): MenuEntry[] => {
    const out: MenuEntry[] = [];
    if (enabled.length > 0) {
      out.push({ type: "label", label: "本机 Agent" });
      for (const a of enabled) {
        out.push({
          label: a.name,
          icon: Cpu,
          checked: backend === `agent:${a.id}`,
          shortcut: a.is_default ? "默认" : undefined,
          onSelect: () => {
            void setBackend(`agent:${a.id}`);
            if (a.last_probe?.ok !== true) void probe(a.id);
          },
        });
      }
      out.push({ type: "separator" });
    }
    out.push({ type: "label", label: "API 服务商" });
    if (providers.length === 0) {
      out.push({ label: "添加服务商…", icon: Settings2, onSelect: () => openSettings("provider") });
    }
    for (const p of providers) {
      out.push({
        label: `${p.name} · ${p.model}`,
        icon: Plug,
        checked: backend === "provider" && p.id === activeProviderId,
        onSelect: () => {
          void setBackend("provider");
          void activate(p.id);
        },
      });
    }
    out.push({ type: "separator" });
    out.push({ label: "管理服务商…", icon: Settings2, onSelect: () => openSettings("provider") });
    out.push({ label: "管理 Agent…", icon: Settings2, onSelect: () => openSettings("agent") });
    return out;
  };

  return (
    <button
      onClick={(e) => openMenuAt(e.currentTarget, items(), "end")}
      aria-label="切换 AI 后端与模型"
      data-tip="切换 AI 后端与模型"
      className="flex min-w-0 items-center gap-1.5 rounded-[var(--r-control)] px-1.5 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: current ? statusColor(current) : provider ? "var(--success)" : "var(--warning)" }} />
      <span className="max-w-32 truncate">{label}</span>
      <ChevronDown size={11} className="shrink-0" />
    </button>
  );
}
