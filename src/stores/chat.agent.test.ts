import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../lib/ai/agentFiles", () => ({ syncAfterAgentChanges: vi.fn(async () => {}) }));
vi.mock("../lib/tauri", () => ({
  api: {
    listSessions: vi.fn(),
    getOrCreateSession: vi.fn(),
    listMessages: vi.fn(),
    cancelGeneration: vi.fn(),
    agentsRespondPermission: vi.fn(),
    agentUndoTurn: vi.fn(),
  },
}));

import { api, type AcpPermissionEvent, type ChatSession } from "../lib/tauri";
import { syncAfterAgentChanges } from "../lib/ai/agentFiles";
import { useChat } from "./chat";

const session: ChatSession = { id: 7, book_id: 1, chapter_id: 11, title: "会话", created_at: "" };
const handlers = new Map<string, (ev: { payload: unknown }) => void>();
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });
const perm = (id: string, kind: string): AcpPermissionEvent => ({
  session_id: 7,
  request_id: id,
  title: `请求 ${id}`,
  tool_kind: kind,
  options: [
    { option_id: "ok", name: "允许", kind: "allow_once" },
    { option_id: "no", name: "拒绝", kind: "reject_once" },
  ],
});

describe("chat store · agent 工具调用（阶段 2B）", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useChat.getState().dispose();
    handlers.clear();
    (listen as unknown as Mock).mockImplementation(async (event: string, h: (ev: { payload: unknown }) => void) => {
      handlers.set(event, h);
      return () => {};
    });
    vi.mocked(api.listSessions).mockResolvedValue([session]);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.agentsRespondPermission).mockResolvedValue(undefined);
    useChat.setState({ autoAllow: {} });
    await useChat.getState().initForChapter(11);
  });

  it("权限请求排队：一次一张，应答后出下一张", async () => {
    emit("agent://permission", perm("p1", "edit"));
    emit("agent://permission", perm("p2", "execute"));
    expect(useChat.getState().permission?.request_id).toBe("p1");
    expect(useChat.getState().permissionQueue.map((p) => p.request_id)).toEqual(["p2"]);
    await useChat.getState().respondPermission("ok");
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "p1", "ok");
    expect(useChat.getState().permission?.request_id).toBe("p2");
    expect(useChat.getState().permissionQueue).toEqual([]);
  });

  it("本会话一直允许：同类排队的一并放行，之后同类直接允许不弹卡；别的类照常弹", async () => {
    emit("agent://permission", perm("p1", "edit"));
    emit("agent://permission", perm("p2", "edit"));
    emit("agent://permission", perm("p3", "execute"));
    await useChat.getState().respondPermission("ok", { always: true });
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "p1", "ok");
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "p2", "ok");
    expect(useChat.getState().permission?.request_id).toBe("p3");
    expect(useChat.getState().autoAllow[7]).toEqual(["edit"]);

    emit("agent://permission", perm("p4", "edit"));
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "p4", "ok");
    expect(useChat.getState().permissionQueue).toEqual([]);

    useChat.getState().clearAutoAllow();
    emit("agent://permission", perm("p5", "edit"));
    expect(useChat.getState().permissionQueue.map((p) => p.request_id)).toEqual(["p5"]);
  });

  it("工具调用事件实时更新；回合带文件改动 → 同步目录与编辑器", () => {
    useChat.setState({ streaming: true });
    const t = { id: "t1", title: "改写第二章", kind: "edit", status: "in_progress", paths: [], added: 0, removed: 0 };
    emit("agent://tool", { session_id: 7, tool: t });
    emit("agent://tool", { session_id: 7, tool: { ...t, status: "completed", added: 3 } });
    emit("agent://tool", { session_id: 99, tool: { ...t, id: "别的会话" } });
    expect(useChat.getState().streamTools).toEqual([{ ...t, status: "completed", added: 3 }]);

    const changes = [{ path: "manuscript/0002-二.md", kind: "modified" }];
    emit("agent://turn", { session_id: 7, ok: true, content: "改好了", error: null, changes });
    expect(syncAfterAgentChanges).toHaveBeenCalledWith(changes);
    expect(useChat.getState().streamTools).toEqual([]);
  });

  it("撤销全部改动：调后端、刷新消息、同步改动", async () => {
    const changes = [{ path: "manuscript/0002-二.md", kind: "modified" as const }];
    vi.mocked(api.agentUndoTurn).mockResolvedValue({ undone: true, changes });
    await useChat.getState().undoAgentTurn(55);
    expect(api.agentUndoTurn).toHaveBeenCalledWith(55);
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(syncAfterAgentChanges).toHaveBeenCalledWith(changes);
  });
});
