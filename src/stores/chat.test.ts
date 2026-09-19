import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("../lib/tauri", () => ({
  api: {
    getOrCreateSession: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageAcp: vi.fn(),
    cancelGeneration: vi.fn(),
    cancelGenerationAcp: vi.fn(),
    agentsRespondPermission: vi.fn(),
    deleteMessage: vi.fn(),
  },
}));

import { api, ChatMessage } from "../lib/tauri";
import { useAgents } from "./agents";
import { useChat } from "./chat";

const session = { id: 7, book_id: 1, chapter_id: 11, title: "一 · AI", created_at: "" };
const session2 = { id: 8, book_id: 1, chapter_id: 12, title: "二 · AI", created_at: "" };
const userMsg: ChatMessage = { id: 101, session_id: 7, role: "user", content: "续写一段", created_at: "" };
const aiMsg: ChatMessage = { id: 102, session_id: 7, role: "assistant", content: "夜色渐深", created_at: "" };

const listenMock = listen as unknown as Mock;
const unlisten = vi.fn();
// 事件名 → 处理器（一个 init 会建立 stream://N + 三个 agent:// 监听）
const handlers = new Map<string, (ev: { payload: unknown }) => void>();
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });

async function init(messages: ChatMessage[] = []) {
  vi.mocked(api.getOrCreateSession).mockResolvedValue(session);
  vi.mocked(api.listMessages).mockResolvedValue(messages);
  await useChat.getState().initForChapter(11);
}

describe("chat store", () => {
  beforeEach(() => {
    // dispose 清掉上一条测试残留在模块级 activeUnlistens 里的监听，再清计数
    useChat.getState().dispose();
    handlers.clear();
    unlisten.mockClear();
    listenMock.mockImplementation(async (event: string, h: (ev: { payload: unknown }) => void) => {
      handlers.set(event, h);
      return unlisten;
    });
    vi.mocked(api.cancelGeneration).mockResolvedValue(undefined);
    vi.mocked(api.cancelGenerationAcp).mockResolvedValue(undefined);
    vi.mocked(api.agentsRespondPermission).mockResolvedValue(undefined);
    useChat.setState({
      sessionId: null, messages: [], streaming: false, streamText: "",
      error: null, permission: null, pendingAppend: null,
    });
    useAgents.setState({ backend: null });
  });

  it("initForChapter 建会话、拉取历史消息并建立事件监听（provider stream:// + ACP agent:// 并列）", async () => {
    vi.mocked(api.getOrCreateSession).mockResolvedValue(session);
    vi.mocked(api.listMessages).mockResolvedValue([userMsg]);
    await useChat.getState().initForChapter(11);
    expect(api.getOrCreateSession).toHaveBeenCalledWith(11);
    expect(useChat.getState().sessionId).toBe(7);
    expect(useChat.getState().messages).toEqual([userMsg]);
    expect(listenMock).toHaveBeenCalledWith("stream://7", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("agent://stream", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("agent://permission", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("agent://turn", expect.any(Function));
    expect(unlisten).not.toHaveBeenCalled();
  });

  it("换章节时解除旧监听并按新会话重建", async () => {
    vi.mocked(api.getOrCreateSession).mockResolvedValueOnce(session).mockResolvedValueOnce(session2);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    await useChat.getState().initForChapter(11);
    await useChat.getState().initForChapter(12);
    // 两次 init × 每次监听后即被下一次 init 解除
    expect(unlisten).toHaveBeenCalledTimes(4);
    expect(useChat.getState().sessionId).toBe(8);
  });

  it("dispose 解除监听（组件卸载路径）", async () => {
    await init();
    useChat.getState().dispose();
    expect(unlisten).toHaveBeenCalledTimes(4);
  });

  it("send 完整流程：乐观气泡→替换为落库记录→delta 累积→done 定稿并以 listMessages 刷新", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    vi.mocked(api.listMessages).mockResolvedValueOnce([]).mockResolvedValueOnce([userMsg, aiMsg]);
    await init();

    const ok = await useChat.getState().send("续写一段");
    expect(ok).toBe(true);
    expect(api.sendMessage).toHaveBeenCalledWith(7, "续写一段");
    expect(useChat.getState().streaming).toBe(true);
    expect(useChat.getState().messages).toEqual([userMsg]);

    emit("stream://7", { type: "delta", text: "夜色" });
    emit("stream://7", { type: "delta", text: "渐深" });
    expect(useChat.getState().streamText).toBe("夜色渐深");

    emit("stream://7", { type: "done", session_id: 7, content: "夜色渐深" });
    expect(useChat.getState().streaming).toBe(false);
    expect(useChat.getState().streamText).toBe("");
    // 以 listMessages 刷新为准（服务端记录替换本地定稿）
    await vi.waitFor(() => {
      expect(useChat.getState().messages).toEqual([userMsg, aiMsg]);
    });
  });

  it("error 事件置 error 并结束流式", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");

    emit("stream://7", { type: "error", message: "未配置可用的 AI 服务商" });
    expect(useChat.getState().streaming).toBe(false);
    expect(useChat.getState().streamText).toBe("");
    expect(useChat.getState().error).toBe("未配置可用的 AI 服务商");
  });

  it("sendMessage invoke 失败：返回 false、置 error、恢复非流式", async () => {
    vi.mocked(api.sendMessage).mockRejectedValue(new Error("网络错误"));
    await init();
    const ok = await useChat.getState().send("续写一段");
    expect(ok).toBe(false);
    expect(useChat.getState().streaming).toBe(false);
    expect(useChat.getState().error).toContain("网络错误");
    // 乐观气泡保留，用户可见自己发过的指令
    expect(useChat.getState().messages).toHaveLength(1);
    expect(useChat.getState().messages[0].role).toBe("user");
  });

  it("流式进行中或空指令时 send 拒绝", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    expect(await useChat.getState().send("   ")).toBe(false);
    expect(await useChat.getState().send("续写")).toBe(true);
    expect(await useChat.getState().send("再来一段")).toBe(false);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("stop 调用 cancelGeneration，流式状态等后端补发 done 收尾", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");
    await useChat.getState().stop();
    expect(api.cancelGeneration).toHaveBeenCalledWith(7);
    expect(api.cancelGenerationAcp).not.toHaveBeenCalled();
    expect(useChat.getState().streaming).toBe(true);
    // 后端对已收增量补发 done
    emit("stream://7", { type: "done", session_id: 7, content: "部分内容" });
    expect(useChat.getState().streaming).toBe(false);
  });

  it("adopt 置 pendingAppend 并把该消息从会话移除、调后端删除", async () => {
    await init([userMsg, aiMsg]);
    await useChat.getState().adopt(102);
    expect(useChat.getState().pendingAppend).toBe("夜色渐深");
    expect(useChat.getState().messages).toEqual([userMsg]);
    expect(api.deleteMessage).toHaveBeenCalledWith(102);

    useChat.getState().clearPendingAppend();
    expect(useChat.getState().pendingAppend).toBeNull();
  });

  it("deleteMessage 调后端并移出本地列表", async () => {
    await init([userMsg, aiMsg]);
    await useChat.getState().deleteMessage(101);
    expect(api.deleteMessage).toHaveBeenCalledWith(101);
    expect(useChat.getState().messages).toEqual([aiMsg]);
  });

  it("initForChapter 失败置 error 且不建立会话", async () => {
    vi.mocked(api.getOrCreateSession).mockRejectedValue(new Error("db 打不开"));
    await useChat.getState().initForChapter(11);
    expect(useChat.getState().sessionId).toBeNull();
    expect(useChat.getState().error).toContain("db 打不开");
    expect(listenMock).not.toHaveBeenCalled();
  });

  // ---- M2：ACP 双后端 ----

  it("send 分流：agent 后端走 send_message_acp，user 消息同样先落库", async () => {
    useAgents.setState({ backend: "agent:claude" });
    vi.mocked(api.sendMessageAcp).mockResolvedValue(userMsg);
    await init();

    const ok = await useChat.getState().send("续写一段");
    expect(ok).toBe(true);
    expect(api.sendMessageAcp).toHaveBeenCalledWith(7, "续写一段");
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(useChat.getState().streaming).toBe(true);
    expect(useChat.getState().messages).toEqual([userMsg]);
  });

  it("send 分流：backend 未加载（null）时按 provider 路径兜底", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessageAcp).not.toHaveBeenCalled();
  });

  it("agent://stream 按 session_id 匹配追加 streamText；不匹配的会话忽略", async () => {
    vi.mocked(api.sendMessageAcp).mockResolvedValue(userMsg);
    useAgents.setState({ backend: "agent:claude" });
    await init();
    await useChat.getState().send("续写一段");

    emit("agent://stream", { session_id: 999, text: "别处" });
    expect(useChat.getState().streamText).toBe("");
    emit("agent://stream", { session_id: 7, text: "夜色" });
    emit("agent://stream", { session_id: 7, text: "渐深" });
    expect(useChat.getState().streamText).toBe("夜色渐深");
  });

  it("agent://turn ok：结束流式、本地定稿 assistant 并以 listMessages 刷新", async () => {
    vi.mocked(api.sendMessageAcp).mockResolvedValue(userMsg);
    vi.mocked(api.listMessages).mockResolvedValueOnce([]).mockResolvedValueOnce([userMsg, aiMsg]);
    useAgents.setState({ backend: "agent:claude" });
    await init();
    await useChat.getState().send("续写一段");
    emit("agent://stream", { session_id: 7, text: "夜色渐深" });

    emit("agent://turn", { session_id: 7, ok: true, content: "夜色渐深", error: null });
    expect(useChat.getState().streaming).toBe(false);
    expect(useChat.getState().streamText).toBe("");
    await vi.waitFor(() => {
      expect(useChat.getState().messages).toEqual([userMsg, aiMsg]);
    });
  });

  it("agent://turn 失败：复用 error 路径显示错误并清流式状态与权限卡", async () => {
    await init();
    useChat.setState({ streaming: true, streamText: "部分", permission: { session_id: 7, request_id: "r1", title: "t", options: [] } });
    emit("agent://turn", { session_id: 7, ok: false, content: null, error: "agent 启动失败" });
    expect(useChat.getState().streaming).toBe(false);
    expect(useChat.getState().streamText).toBe("");
    expect(useChat.getState().permission).toBeNull();
    expect(useChat.getState().error).toBe("agent 启动失败");
  });

  it("agent://turn 指向其他会话时忽略", async () => {
    await init();
    useChat.setState({ streaming: true });
    emit("agent://turn", { session_id: 999, ok: true, content: "x", error: null });
    expect(useChat.getState().streaming).toBe(true);
  });

  it("agent://permission：session 匹配置权限卡（一次一张），不匹配忽略", async () => {
    await init();
    const perm = {
      session_id: 7, request_id: "r1", title: "Bash: npm install",
      options: [
        { option_id: "o1", name: "允许一次", kind: "allow_once" },
        { option_id: "o2", name: "拒绝", kind: "reject_once" },
      ],
    };
    emit("agent://permission", { ...perm, session_id: 999 });
    expect(useChat.getState().permission).toBeNull();
    emit("agent://permission", perm);
    expect(useChat.getState().permission?.request_id).toBe("r1");
  });

  it("respondPermission：清除卡片并调 agents_respond_permission；换章节时权限卡重置", async () => {
    await init();
    emit("agent://permission", {
      session_id: 7, request_id: "r1", title: "Bash",
      options: [{ option_id: "o1", name: "允许一次", kind: "allow_once" }],
    });
    await useChat.getState().respondPermission("o1");
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "r1", "o1");
    expect(useChat.getState().permission).toBeNull();

    // 换章节清残留
    emit("agent://permission", { session_id: 7, request_id: "r2", title: "Bash", options: [] });
    vi.mocked(api.getOrCreateSession).mockResolvedValue(session2);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    await useChat.getState().initForChapter(12);
    expect(useChat.getState().permission).toBeNull();
  });

  it("stop 分流：agent 后端走 cancel_generation_acp", async () => {
    useAgents.setState({ backend: "agent:claude" });
    vi.mocked(api.sendMessageAcp).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");
    await useChat.getState().stop();
    expect(api.cancelGenerationAcp).toHaveBeenCalledWith(7);
    expect(api.cancelGeneration).not.toHaveBeenCalled();
  });
});
