import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ requestUserAttention: vi.fn(async () => {}) }),
  UserAttentionType: { Critical: 1, Informational: 2 },
}));
vi.mock("../lib/tauri", () => ({
  api: {
    listSessions: vi.fn(),
    getOrCreateSession: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    messageRate: vi.fn(),
  },
}));

import { api, type ChatMessage, type ChatSession } from "../lib/tauri";
import { useAgents } from "./agents";
import { useChat } from "./chat";
import { notifyIfAway, LONG_TASK_MS } from "../lib/ai/notify";

const session: ChatSession = { id: 7, book_id: 1, chapter_id: 11, title: "会话", created_at: "" };
const userMsg = (id: number, content: string): ChatMessage => ({ id, session_id: 7, role: "user", content, created_at: "" });
const handlers = new Map<string, (ev: { payload: unknown }) => void>();
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("chat store · 排队与插话 / 评分 / 完成通知（阶段 2C）", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    useChat.getState().dispose();
    handlers.clear();
    (listen as unknown as Mock).mockImplementation(async (event: string, h: (ev: { payload: unknown }) => void) => {
      handlers.set(event, h);
      return () => {};
    });
    useAgents.setState({ backend: null });
    vi.mocked(api.listSessions).mockResolvedValue([session]);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    vi.mocked(api.cancelGeneration).mockResolvedValue(undefined);
    let n = 100;
    vi.mocked(api.sendMessage).mockImplementation(async (_sid: number, text: string) => userMsg(++n, text));
    useChat.setState({ queue: [], pendingCandidates: null, candidates: 1 });
    await useChat.getState().initForChapter(11);
  });

  it("生成中排队：这一轮正常结束后自动依次发出", async () => {
    await useChat.getState().send("第一问");
    useChat.getState().enqueue("第二问", { mode: "discuss" });
    useChat.getState().enqueue("第三问");
    expect(useChat.getState().queue.map((q) => q.text)).toEqual(["第二问", "第三问"]);
    emit("stream://7", { type: "done", session_id: 7, content: "答一" });
    await flush();
    await flush();
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.sendMessage).mock.calls[1][1]).toBe("第二问");
    expect(vi.mocked(api.sendMessage).mock.calls[1][2]).toMatchObject({ mode: "discuss" });
    expect(useChat.getState().queue.map((q) => q.text)).toEqual(["第三问"]);
  });

  it("插话：提到队首并停止当前生成，停下后立即发出；出错时不自动发、队列保留", async () => {
    await useChat.getState().send("第一问");
    useChat.getState().enqueue("甲");
    useChat.getState().enqueue("乙");
    await useChat.getState().interject(1);
    expect(api.cancelGeneration).toHaveBeenCalledWith(7);
    expect(useChat.getState().queue.map((q) => q.text)).toEqual(["乙", "甲"]);
    emit("stream://7", { type: "done", session_id: 7, content: "答了一半" });
    await flush();
    await flush();
    expect(vi.mocked(api.sendMessage).mock.calls[1][1]).toBe("乙");

    emit("stream://7", { type: "error", session_id: 7, message: "网络断了", kind: "network", partial: "" });
    await flush();
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(useChat.getState().queue.map((q) => q.text)).toEqual(["甲"]);
    useChat.getState().removeQueued(0);
    expect(useChat.getState().queue).toEqual([]);
  });

  it("评分：本地消息带上 rating", async () => {
    useChat.setState({ messages: [{ ...userMsg(5, "x"), role: "assistant" }] });
    vi.mocked(api.messageRate).mockResolvedValue({} as ChatMessage);
    await useChat.getState().rateMessage(5, -1);
    expect(api.messageRate).toHaveBeenCalledWith(5, -1);
    expect(useChat.getState().messages[0].rating).toBe(-1);
  });

  it("完成通知：只在长任务且窗口不在前台时提示，回到窗口复原标题", () => {
    document.title = "笔仙";
    const focus = vi.spyOn(document, "hasFocus");
    focus.mockReturnValue(false);
    expect(notifyIfAway(Date.now() - 1000, "AI 已完成")).toBe(false);
    expect(notifyIfAway(Date.now() - LONG_TASK_MS - 1, "AI 已完成")).toBe(true);
    expect(document.title).toBe("✓ AI 已完成 · 笔仙");
    window.dispatchEvent(new Event("focus"));
    expect(document.title).toBe("笔仙");
    focus.mockReturnValue(true);
    expect(notifyIfAway(Date.now() - LONG_TASK_MS - 1, "AI 已完成")).toBe(false);
    focus.mockRestore();
  });
});
