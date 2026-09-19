import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("../lib/tauri", () => ({
  api: {
    getOrCreateSession: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    cancelGeneration: vi.fn(),
    deleteMessage: vi.fn(),
  },
}));

import { api, ChatMessage } from "../lib/tauri";
import { StreamEvent, useChat } from "./chat";

const session = { id: 7, book_id: 1, chapter_id: 11, title: "一 · AI", created_at: "" };
const session2 = { id: 8, book_id: 1, chapter_id: 12, title: "二 · AI", created_at: "" };
const userMsg: ChatMessage = { id: 101, session_id: 7, role: "user", content: "续写一段", created_at: "" };
const aiMsg: ChatMessage = { id: 102, session_id: 7, role: "assistant", content: "夜色渐深", created_at: "" };

const listenMock = listen as unknown as Mock;
const unlisten = vi.fn();
let handler: ((ev: { payload: StreamEvent }) => void) | null = null;
const emit = (payload: StreamEvent) => handler?.({ payload });

async function init(messages: ChatMessage[] = []) {
  vi.mocked(api.getOrCreateSession).mockResolvedValue(session);
  vi.mocked(api.listMessages).mockResolvedValue(messages);
  await useChat.getState().initForChapter(11);
}

describe("chat store", () => {
  beforeEach(() => {
    // dispose 清掉上一条测试残留在模块级 activeUnlisten 里的监听，再清计数
    useChat.getState().dispose();
    handler = null;
    unlisten.mockClear();
    listenMock.mockImplementation(async (_event: string, h: (ev: { payload: StreamEvent }) => void) => {
      handler = h;
      return unlisten;
    });
    vi.mocked(api.cancelGeneration).mockResolvedValue(undefined);
    vi.mocked(api.deleteMessage).mockResolvedValue(undefined);
    useChat.setState({ sessionId: null, messages: [], streaming: false, streamText: "", error: null, pendingAppend: null });
  });

  it("initForChapter 建会话、拉取历史消息并建立事件监听", async () => {
    vi.mocked(api.getOrCreateSession).mockResolvedValue(session);
    vi.mocked(api.listMessages).mockResolvedValue([userMsg]);
    await useChat.getState().initForChapter(11);
    expect(api.getOrCreateSession).toHaveBeenCalledWith(11);
    expect(useChat.getState().sessionId).toBe(7);
    expect(useChat.getState().messages).toEqual([userMsg]);
    expect(listenMock).toHaveBeenCalledWith("stream://7", expect.any(Function));
    expect(unlisten).not.toHaveBeenCalled();
  });

  it("换章节时解除旧监听并按新会话重建", async () => {
    vi.mocked(api.getOrCreateSession).mockResolvedValueOnce(session).mockResolvedValueOnce(session2);
    vi.mocked(api.listMessages).mockResolvedValue([]);
    await useChat.getState().initForChapter(11);
    await useChat.getState().initForChapter(12);
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(useChat.getState().sessionId).toBe(8);
  });

  it("dispose 解除监听（组件卸载路径）", async () => {
    await init();
    useChat.getState().dispose();
    expect(unlisten).toHaveBeenCalledTimes(1);
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

    emit({ type: "delta", text: "夜色" });
    emit({ type: "delta", text: "渐深" });
    expect(useChat.getState().streamText).toBe("夜色渐深");

    emit({ type: "done", session_id: 7, content: "夜色渐深" });
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

    emit({ type: "error", message: "未配置可用的 AI 服务商" });
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
    expect(useChat.getState().streaming).toBe(true);
    // 后端对已收增量补发 done
    emit({ type: "done", session_id: 7, content: "部分内容" });
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
});
