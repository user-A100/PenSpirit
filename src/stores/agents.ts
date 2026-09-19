import { create } from "zustand";
import { api, AgentDescriptor, ProbeResult } from "../lib/tauri";

/**
 * 后端选择（localStorage `bixian.chat.backend`）：
 * - `"agent:{id}"`：ACP agent 直连（Rust 侧按 agents.json 的 is_default 发车，
 *   因此前端选择 agent 时必须同步调 agents_set_default，见 setBackend）
 * - `"provider"`：M1 的 HTTP API 直连（高级后备路径）
 */
export const BACKEND_STORAGE_KEY = "bixian.chat.backend";

/** 可用 = 启用且最近一次探测通过（未探测不算可用，只给灰点展示）。 */
export function isAgentAvailable(a: AgentDescriptor): boolean {
  return a.enabled && a.last_probe?.ok === true;
}

/**
 * 后端解析规则（默认选择规则）：
 * 1. 已存 "provider" → 沿用；
 * 2. 已存 "agent:{id}" 且该 agent 存在且启用 → 沿用（用户明确选过，探测失败也保留）；
 * 3. 否则重新解析：可用 agent 里默认项优先，其次列表中第一个可用；
 * 4. 无可用 agent → "provider"。
 */
export function resolveBackend(stored: string | null, agents: AgentDescriptor[]): string {
  if (stored === "provider") return "provider";
  if (stored != null && stored.startsWith("agent:")) {
    const id = stored.slice("agent:".length);
    if (agents.some((a) => a.id === id && a.enabled)) return stored;
  }
  const available = agents.filter(isAgentAvailable);
  const pick = available.find((a) => a.is_default) ?? available[0];
  return pick ? `agent:${pick.id}` : "provider";
}

interface AgentsState {
  agents: AgentDescriptor[];
  /** null = 尚未 load（消费方按 provider 路径兜底） */
  backend: string | null;
  probing: Set<string>;
  error: string | null;
  load: () => Promise<void>;
  /** 探测并回写本地条目（Rust 侧同步写 agents.json） */
  probe: (id: string) => Promise<ProbeResult | null>;
  setDefault: (id: string) => Promise<void>;
  upsert: (desc: AgentDescriptor) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** 选择后端：agent:* 会连带把该 agent 设为默认（保证 Rust 发车目标一致） */
  setBackend: (backend: string) => Promise<void>;
}

/** 解析当前后端并持久化（load 与 remove 后的统一收口）。 */
function persistBackend(agents: AgentDescriptor[], current: string | null): string {
  const backend = resolveBackend(current, agents);
  localStorage.setItem(BACKEND_STORAGE_KEY, backend);
  return backend;
}

export const useAgents = create<AgentsState>((set, get) => ({
  agents: [],
  backend: null,
  probing: new Set(),
  error: null,

  load: async () => {
    try {
      const agents = await api.agentsList();
      const backend = persistBackend(agents, localStorage.getItem(BACKEND_STORAGE_KEY));
      set({ agents, backend, error: null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  probe: async (id) => {
    set((st) => ({ probing: new Set(st.probing).add(id), error: null }));
    try {
      const result = await api.agentsProbe(id);
      set((st) => ({
        agents: st.agents.map((a) => (a.id === id ? { ...a, last_probe: result } : a)),
      }));
      return result;
    } catch (e) {
      set({ error: String(e) });
      return null;
    } finally {
      set((st) => {
        const next = new Set(st.probing);
        next.delete(id);
        return { probing: next };
      });
    }
  },

  setDefault: async (id) => {
    await api.agentsSetDefault(id);
    set((st) => ({ agents: st.agents.map((a) => ({ ...a, is_default: a.id === id })) }));
  },

  upsert: async (desc) => {
    await api.agentsUpsert(desc);
    set((st) => ({
      agents: st.agents.some((a) => a.id === desc.id)
        ? st.agents.map((a) => (a.id === desc.id ? desc : a))
        : [...st.agents, desc],
      error: null,
    }));
  },

  remove: async (id) => {
    await api.agentsRemove(id);
    const agents = get().agents.filter((a) => a.id !== id);
    const backend = persistBackend(agents, get().backend);
    set({ agents, backend });
    // 维持不变量：agent 后端指向的 agent 必须是默认位（Rust 按 is_default 发车）
    if (backend.startsWith("agent:")) {
      const nextId = backend.slice("agent:".length);
      if (!agents.some((a) => a.id === nextId && a.is_default)) {
        try {
          await get().setDefault(nextId);
        } catch (e) {
          set({ error: String(e) });
        }
      }
    }
  },

  setBackend: async (backend) => {
    localStorage.setItem(BACKEND_STORAGE_KEY, backend);
    set({ backend });
    if (!backend.startsWith("agent:")) return;
    const id = backend.slice("agent:".length);
    const cur = get().agents.find((a) => a.is_default);
    if (cur?.id === id) return;
    try {
      await get().setDefault(id);
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
