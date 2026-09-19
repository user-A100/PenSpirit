import { beforeEach, describe, expect, it, vi } from "vitest";

// agents.json 在 Rust 侧是有状态的：list/probe/upsert/remove/set_default 都会改它。
// 这里用 hoisted 可变数组模拟，load 回填与回写才有真实数据可验。
const backend = vi.hoisted(() => ({ agents: [] as Array<Record<string, unknown>> }));

vi.mock("../lib/tauri", () => ({
  api: {
    agentsList: vi.fn().mockImplementation(async () => backend.agents.map((a) => ({ ...a }))),
    agentsProbe: vi.fn().mockImplementation(async (id: string) => {
      const target = backend.agents.find((a) => a.id === id);
      if (!target) throw new Error(`agent 不存在: ${id}`);
      return { ok: true, agent_name: "Probed", protocol_version: "v1", can_resume: false, detail: null };
    }),
    agentsUpsert: vi.fn(),
    agentsRemove: vi.fn(),
    agentsSetDefault: vi.fn().mockImplementation(async (id: string) => {
      for (const a of backend.agents) a.is_default = a.id === id;
    }),
  },
}));

import { api } from "../lib/tauri";
import { BACKEND_STORAGE_KEY, useAgents } from "./agents";

const probeOk = { ok: true, agent_name: "Claude Code", protocol_version: "v1", can_resume: false, detail: null };
const probeFail = { ok: false, agent_name: null, protocol_version: null, can_resume: false, detail: "未找到命令" };

const claudeOk = { id: "claude", name: "Claude Code", command: "claude-agent-acp", args: [], enabled: true, is_default: true, last_probe: { ...probeOk } };
const codexOk = { id: "codex", name: "Codex", command: "codex-acp", args: [], enabled: true, is_default: false, last_probe: { ...probeOk } };
const geminiUnprobed = { id: "gemini", name: "Gemini", command: "gemini", args: ["--acp", "--skip-trust"], enabled: true, is_default: false, last_probe: null };
const claudeFailed = { ...claudeOk, last_probe: { ...probeFail } };

function seedAgents(...agents: Array<Record<string, unknown>>) {
  backend.agents = agents.map((a) => ({ ...a, last_probe: a.last_probe ? { ...a.last_probe } : null }));
}

describe("agents store", () => {
  beforeEach(() => {
    localStorage.clear();
    seedAgents({ ...claudeOk }, { ...codexOk }, { ...geminiUnprobed });
    useAgents.setState({ agents: [], backend: null, probing: new Set(), error: null });
    vi.clearAllMocks();
  });

  it("load 填充列表；localStorage 无值且有可用 agent 时选默认 agent 并持久化", async () => {
    await useAgents.getState().load();
    expect(api.agentsList).toHaveBeenCalledTimes(1);
    expect(useAgents.getState().agents).toHaveLength(3);
    expect(useAgents.getState().backend).toBe("agent:claude"); // 默认项可用 → 直接选默认
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("agent:claude");
    expect(useAgents.getState().error).toBeNull();
  });

  it("默认 agent 不可用时选第一个可用 agent", async () => {
    seedAgents({ ...claudeFailed }, { ...codexOk });
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("agent:codex");
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("agent:codex");
  });

  it("无可用 agent（全部未探测）时默认 provider", async () => {
    seedAgents({ ...geminiUnprobed });
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("provider");
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("provider");
  });

  it("localStorage 已存有效值则沿用（provider / 指向存在且启用的 agent）", async () => {
    localStorage.setItem(BACKEND_STORAGE_KEY, "provider");
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("provider");

    localStorage.setItem(BACKEND_STORAGE_KEY, "agent:gemini"); // 未探测但启用 → 用户明确选过，保留
    useAgents.setState({ backend: null });
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("agent:gemini");
  });

  it("存量后端指向的 agent 已不存在时重新解析", async () => {
    localStorage.setItem(BACKEND_STORAGE_KEY, "agent:gone");
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("agent:claude");
  });

  it("load 失败置 error", async () => {
    vi.mocked(api.agentsList).mockRejectedValueOnce(new Error("配置目录不可读"));
    await useAgents.getState().load();
    expect(useAgents.getState().error).toContain("配置目录不可读");
    expect(useAgents.getState().agents).toHaveLength(0);
  });

  it("probe：probing 标记进出，结果回写本地条目", async () => {
    await useAgents.getState().load();
    const p = useAgents.getState().probe("gemini");
    expect(useAgents.getState().probing.has("gemini")).toBe(true);
    const result = await p;
    expect(result?.ok).toBe(true);
    expect(api.agentsProbe).toHaveBeenCalledWith("gemini");
    const gemini = useAgents.getState().agents.find((a) => a.id === "gemini");
    expect(gemini?.last_probe?.ok).toBe(true);
    expect(useAgents.getState().probing.has("gemini")).toBe(false);
  });

  it("probe 失败：置 error、清 probing、结果仍回写本地条目", async () => {
    await useAgents.getState().load();
    vi.mocked(api.agentsProbe).mockRejectedValueOnce(new Error("探测超时"));
    const result = await useAgents.getState().probe("gemini");
    expect(result).toBeNull();
    expect(useAgents.getState().error).toContain("探测超时");
    expect(useAgents.getState().probing.size).toBe(0);
  });

  it("setDefault 调后端并本地翻转 is_default", async () => {
    await useAgents.getState().load();
    await useAgents.getState().setDefault("codex");
    expect(api.agentsSetDefault).toHaveBeenCalledWith("codex");
    const agents = useAgents.getState().agents;
    expect(agents.find((a) => a.id === "codex")?.is_default).toBe(true);
    expect(agents.find((a) => a.id === "claude")?.is_default).toBe(false);
  });

  it("setBackend 选 agent：写入 localStorage、更新选择并把该 agent 设为默认", async () => {
    await useAgents.getState().load();
    await useAgents.getState().setBackend("agent:codex");
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("agent:codex");
    expect(useAgents.getState().backend).toBe("agent:codex");
    expect(api.agentsSetDefault).toHaveBeenCalledWith("codex"); // Rust 按 is_default 发车，选择须同步默认位
    expect(useAgents.getState().agents.find((a) => a.id === "codex")?.is_default).toBe(true);
  });

  it("setBackend 选已是默认的 agent 不重复调 setDefault", async () => {
    await useAgents.getState().load();
    await useAgents.getState().setBackend("agent:claude");
    expect(api.agentsSetDefault).not.toHaveBeenCalled();
  });

  it("setBackend 选 provider：只存选择，不动默认位", async () => {
    await useAgents.getState().load();
    await useAgents.getState().setBackend("provider");
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("provider");
    expect(useAgents.getState().backend).toBe("provider");
    expect(api.agentsSetDefault).not.toHaveBeenCalled();
  });

  it("upsert 更新已有条目 / 追加新条目", async () => {
    await useAgents.getState().load();
    await useAgents.getState().upsert({ ...geminiUnprobed, enabled: false });
    expect(useAgents.getState().agents).toHaveLength(3);
    expect(useAgents.getState().agents.find((a) => a.id === "gemini")?.enabled).toBe(false);

    const custom = { id: "custom:abc", name: "自订", command: "my-agent", args: [], enabled: true, is_default: false, last_probe: null };
    await useAgents.getState().upsert(custom);
    expect(useAgents.getState().agents).toHaveLength(4);
    expect(useAgents.getState().agents[useAgents.getState().agents.length - 1].id).toBe("custom:abc");
  });

  it("remove 移除条目；后端指向被删 agent 时重新解析并维持默认一致", async () => {
    localStorage.setItem(BACKEND_STORAGE_KEY, "agent:claude");
    await useAgents.getState().load();
    expect(useAgents.getState().backend).toBe("agent:claude");

    await useAgents.getState().remove("claude");
    expect(api.agentsRemove).toHaveBeenCalledWith("claude");
    expect(useAgents.getState().agents).toHaveLength(2);
    // claude 没了 → 重新解析到下一个可用 agent:codex，且 codex 补位默认
    expect(useAgents.getState().backend).toBe("agent:codex");
    expect(localStorage.getItem(BACKEND_STORAGE_KEY)).toBe("agent:codex");
    expect(api.agentsSetDefault).toHaveBeenCalledWith("codex");
  });

  it("remove 未被选中的 agent 不改变后端选择", async () => {
    await useAgents.getState().load(); // → agent:claude
    await useAgents.getState().remove("gemini");
    expect(useAgents.getState().backend).toBe("agent:claude");
    expect(api.agentsSetDefault).not.toHaveBeenCalled();
  });
});
