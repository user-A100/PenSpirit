import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("../lib/tauri", () => ({
  api: {
    listSessions: vi.fn(),
    getOrCreateSession: vi.fn(),
    sessionCreate: vi.fn(),
    listMessages: vi.fn(),
    cancelGeneration: vi.fn(),
    sessionFork: vi.fn(),
    sessionSetPinned: vi.fn(),
    sessionSetArchived: vi.fn(),
    messageStar: vi.fn(),
  },
}));

import { api, type ChatMessage, type ChatSession } from "../lib/tauri";
import { useChat } from "./chat";

const s = (id: number, extra: Partial<ChatSession> = {}): ChatSession => ({ id, book_id: 1, chapter_id: 11, title: `会话${id}`, created_at: "", ...extra });
const msg: ChatMessage = { id: 102, session_id: 7, role: "assistant", content: "夜色渐深", created_at: "", reply_to: 101, active: true };

describe("chat store · 会话管理（阶段 2B）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChat.getState().dispose();
    useChat.setState({ openAfterInit: null });
    (listen as unknown as Mock).mockResolvedValue(() => {});
    vi.mocked(api.listMessages).mockResolvedValue([]);
  });

  it("打开章节时跳过已归档会话，取最近一个未归档的", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s(9, { archived: true }), s(8), s(7)]);
    await useChat.getState().initForChapter(11);
    expect(useChat.getState().sessionId).toBe(8);
  });

  it("搜索跳转：openAfterInit 指定的会话优先（即使已归档），用完清空", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s(8), s(9, { archived: true })]);
    useChat.setState({ openAfterInit: 9 });
    await useChat.getState().initForChapter(11);
    expect(useChat.getState().sessionId).toBe(9);
    expect(useChat.getState().openAfterInit).toBeNull();
  });

  it("从某条消息分叉：新会话排最前并打开", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s(7)]);
    await useChat.getState().initForChapter(11);
    vi.mocked(api.sessionFork).mockResolvedValue(s(20, { title: "会话7（分叉）" }));
    await useChat.getState().forkSession(102);
    expect(api.sessionFork).toHaveBeenCalledWith(7, 102);
    expect(useChat.getState().sessions[0].id).toBe(20);
    expect(useChat.getState().sessionId).toBe(20);
  });

  it("归档当前会话：切到下一个未归档的；没有就新建", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s(7), s(8)]);
    await useChat.getState().initForChapter(11);
    vi.mocked(api.sessionSetArchived).mockResolvedValue(s(7, { archived: true }));
    vi.mocked(api.listSessions).mockResolvedValue([s(8), s(7, { archived: true })]);
    await useChat.getState().setSessionArchived(7, true);
    expect(useChat.getState().sessionId).toBe(8);

    vi.mocked(api.listSessions).mockResolvedValue([s(7, { archived: true }), s(8, { archived: true })]);
    vi.mocked(api.sessionCreate).mockResolvedValue(s(30));
    await useChat.getState().setSessionArchived(8, true);
    expect(api.sessionCreate).toHaveBeenCalled();
    expect(useChat.getState().sessionId).toBe(30);
  });

  it("置顶后刷新会话列表", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s(7), s(8)]);
    await useChat.getState().initForChapter(11);
    vi.mocked(api.sessionSetPinned).mockResolvedValue(s(8, { pinned: true }));
    vi.mocked(api.listSessions).mockResolvedValue([s(8, { pinned: true }), s(7)]);
    await useChat.getState().setSessionPinned(8, true);
    expect(useChat.getState().sessions.map((x) => x.id)).toEqual([8, 7]);
    expect(useChat.getState().sessions[0].pinned).toBe(true);
  });

  it("收藏：本地消息带上 starred", async () => {
    useChat.setState({ messages: [msg] });
    vi.mocked(api.messageStar).mockResolvedValue(55);
    await useChat.getState().starMessage(102, true);
    expect(api.messageStar).toHaveBeenCalledWith(102, true);
    expect(useChat.getState().messages[0].starred).toBe(true);
  });
});
