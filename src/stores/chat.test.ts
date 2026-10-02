import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { listen } from "@tauri-apps/api/event";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

vi.mock("../lib/tauri", () => ({
  api: {
    listSessions: vi.fn(),
    getOrCreateSession: vi.fn(),
    sessionCreate: vi.fn(),
    sessionRename: vi.fn(),
    sessionDelete: vi.fn(),
    listMessages: vi.fn(),
    sendMessage: vi.fn(),
    sendMessageAcp: vi.fn(),
    chatRegenerate: vi.fn(),
    chatRegenerateAcp: vi.fn(),
    chatEditTruncate: vi.fn(),
    messageSetActive: vi.fn(),
    messageSetAdopted: vi.fn(),
    cancelGeneration: vi.fn(),
    cancelGenerationAcp: vi.fn(),
    agentsRespondPermission: vi.fn(),
    deleteMessage: vi.fn(),
  },
}));

import { api, type ChatMessage, type ChatSession } from "../lib/tauri";
import { registerEditorBridge, type EditorBridge } from "../lib/editorBridge";
import { useAgents } from "./agents";
import { useWorkspace } from "./workspace";
import { buildTurnOptions, friendlyError, useChat } from "./chat";

const session: ChatSession = { id: 7, book_id: 1, chapter_id: 11, title: "一 · AI", created_at: "" };
const session2: ChatSession = { id: 8, book_id: 1, chapter_id: 11, title: "新对话", created_at: "" };
const userMsg: ChatMessage = { id: 101, session_id: 7, role: "user", content: "续写一段", created_at: "" };
const aiMsg: ChatMessage = { id: 102, session_id: 7, role: "assistant", content: "夜色渐深", created_at: "", reply_to: 101, active: true };

const listenMock = listen as unknown as Mock;
const unlisten = vi.fn();
const handlers = new Map<string, (ev: { payload: unknown }) => void>();
const emit = (event: string, payload: unknown) => handlers.get(event)?.({ payload });

async function init(messages: ChatMessage[] = [], sessions: ChatSession[] = [session]) {
  vi.mocked(api.listSessions).mockResolvedValue(sessions);
  vi.mocked(api.listMessages).mockResolvedValue(messages);
  await useChat.getState().initForChapter(11);
}

describe("chat store v2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useChat.getState().dispose();
    handlers.clear();
    listenMock.mockImplementation(async (event: string, h: (ev: { payload: unknown }) => void) => {
      handlers.set(event, h);
      return unlisten;
    });
    vi.mocked(api.cancelGeneration).mockResolvedValue(undefined);
    vi.mocked(api.cancelGenerationAcp).mockResolvedValue(undefined);
    vi.mocked(api.agentsRespondPermission).mockResolvedValue(undefined);
    vi.mocked(api.messageSetAdopted).mockResolvedValue(aiMsg);
    useChat.setState({
      chapterId: null, sessions: [], sessionId: null, messages: [], streaming: false, streamText: "", streamReplyTo: null,
      error: null, errorCode: null, errorKind: null, lastFailure: null, permission: null,
      mode: "write", targetChars: null, temperature: null, disabledSlots: [], mentions: [], quote: null,
      quoteByMessage: {}, commandByMessage: {},
    });
    useAgents.setState({ backend: null });
  });

  it("initForChapter：有会话打开最近一个；无会话 getOrCreate；建立四路监听", async () => {
    await init([userMsg], [session2, session]);
    expect(useChat.getState().sessionId).toBe(8);
    expect(useChat.getState().sessions).toHaveLength(2);
    expect(listenMock).toHaveBeenCalledWith("stream://8", expect.any(Function));
    expect(listenMock).toHaveBeenCalledWith("agent://turn", expect.any(Function));

    vi.mocked(api.getOrCreateSession).mockResolvedValue(session);
    await init([], []);
    expect(api.getOrCreateSession).toHaveBeenCalledWith(11);
    expect(useChat.getState().sessionId).toBe(7);
  });

  it("send：带上本轮选项；成功后清空本轮 @ 引用/选区/关闭槽位，记下选区与命令", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    useChat.setState({
      mentions: [{ kind: "character", id: 3, label: "南宫婉" }],
      disabledSlots: ["文风"],
      quote: { chapterId: 11, text: "选中的一段", from: 5, to: 10 },
      mode: "discuss",
      targetChars: 800,
    });
    const ok = await useChat.getState().send("帮我润色", { command: "polish", mode: "write" });
    expect(ok).toBe(true);
    const [, instruction, opts] = vi.mocked(api.sendMessage).mock.calls[0];
    expect(instruction).toBe("帮我润色");
    expect(opts).toMatchObject({
      mode: "write",
      selection: "选中的一段",
      disabled_slots: ["文风"],
      mentions: [{ kind: "character", id: 3 }],
      target_chars: 800,
      command: "polish",
    });
    const st = useChat.getState();
    expect(st.streaming).toBe(true);
    expect(st.streamReplyTo).toBe(101);
    expect(st.mentions).toEqual([]);
    expect(st.quote).toBeNull();
    expect(st.disabledSlots).toEqual([]);
    expect(st.quoteByMessage[101].text).toBe("选中的一段");
    expect(st.commandByMessage[101]).toBe("polish");
  });

  it("delta 累积、done 本地定稿为新版本并以 listMessages 刷新", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    vi.mocked(api.listMessages).mockResolvedValue([userMsg, aiMsg]);
    await useChat.getState().send("续写一段");
    emit("stream://7", { type: "delta", text: "夜色" });
    emit("stream://7", { type: "delta", text: "渐深" });
    expect(useChat.getState().streamText).toBe("夜色渐深");
    emit("stream://7", { type: "done", session_id: 7, content: "夜色渐深" });
    expect(useChat.getState().streaming).toBe(false);
    const local = useChat.getState().messages.find((m) => m.role === "assistant")!;
    expect(local.reply_to).toBe(101);
    await vi.waitFor(() => expect(useChat.getState().messages).toEqual([userMsg, aiMsg]));
  });

  it("invoke 失败：撤回乐观气泡、结构化错误给中文、记重试", async () => {
    vi.mocked(api.sendMessage).mockRejectedValue({ code: "invalid", message: "未配置可用的 AI 服务商" });
    await init();
    const ok = await useChat.getState().send("续写一段");
    expect(ok).toBe(false);
    const st = useChat.getState();
    expect(st.messages).toHaveLength(0);
    expect(st.error).toBe("未配置可用的 AI 服务商");
    expect(st.errorCode).toBe("invalid");
    expect(st.lastFailure).toEqual({ kind: "send", instruction: "续写一段", command: null });
  });

  it("多候选：send 带上 candidates；每版落定后自动再生成，凑齐即停", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    vi.mocked(api.chatRegenerate).mockResolvedValue(aiMsg);
    vi.mocked(api.messageSetAdopted).mockResolvedValue(undefined as never);
    await init();
    useChat.getState().setCandidates(3);
    await useChat.getState().send("续写一段");
    expect(vi.mocked(api.sendMessage).mock.calls[0][2]).toMatchObject({ candidates: 3 });
    expect(useChat.getState().pendingCandidates).toEqual({ userMessageId: 101, remaining: 2, total: 3 });
    emit("stream://7", { type: "done", session_id: 7, content: "第一版" });
    await vi.waitFor(() => expect(api.chatRegenerate).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.chatRegenerate).mock.calls[0]).toEqual([101, expect.objectContaining({ candidates: 3 })]);
    emit("stream://7", { type: "done", session_id: 7, content: "第二版" });
    await vi.waitFor(() => expect(api.chatRegenerate).toHaveBeenCalledTimes(2));
    emit("stream://7", { type: "done", session_id: 7, content: "第三版" });
    await vi.waitFor(() => expect(useChat.getState().pendingCandidates).toBeNull());
    expect(api.chatRegenerate).toHaveBeenCalledTimes(2);
    // 「继续写」类命令不并排
    vi.mocked(api.sendMessage).mockClear();
    await useChat.getState().send("接着写", { command: "continue-reply" });
    expect(vi.mocked(api.sendMessage).mock.calls[0][2]).toMatchObject({ candidates: null });
    useChat.getState().setCandidates(1);
  });

  it("重试选项：regenerate 带上 retry_hint", async () => {
    vi.mocked(api.chatRegenerate).mockResolvedValue(aiMsg);
    await init([userMsg, aiMsg]);
    await useChat.getState().regenerate(101, { retryHint: "这次写得更短" });
    expect(vi.mocked(api.chatRegenerate).mock.calls[0][1]).toMatchObject({ retry_hint: "这次写得更短" });
  });

  it("流式错误按类别给说明，重试走重新生成", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    vi.mocked(api.chatRegenerate).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");
    emit("stream://7", { type: "error", message: "Invalid status code: 429", kind: "rate_limit", partial: "" });
    const st = useChat.getState();
    expect(st.streaming).toBe(false);
    expect(st.error).toBe(friendlyError("rate_limit", ""));
    expect(st.lastFailure).toEqual({ kind: "regenerate", userMessageId: 101 });
    await useChat.getState().retry();
    expect(api.chatRegenerate).toHaveBeenCalledWith(101, expect.objectContaining({ mode: "write" }));
  });

  it("regenerate：流式落在该问；done 后新版本选用、旧版本保留", async () => {
    vi.mocked(api.chatRegenerate).mockResolvedValue(userMsg);
    await init([userMsg, aiMsg]);
    await useChat.getState().regenerate(101);
    expect(useChat.getState().streamReplyTo).toBe(101);
    emit("stream://7", { type: "done", session_id: 7, content: "第二版" });
    const replies = useChat.getState().messages.filter((m) => m.reply_to === 101);
    expect(replies).toHaveLength(2);
    expect(replies[0].active).toBe(false);
    expect(replies[1].active).toBe(true);
  });

  it("switchVariant 只翻转同组 active", async () => {
    const v2: ChatMessage = { ...aiMsg, id: 103, content: "二版", active: true };
    await init([userMsg, { ...aiMsg, active: false }, v2]);
    vi.mocked(api.messageSetActive).mockResolvedValue({ ...aiMsg, active: true });
    await useChat.getState().switchVariant(102);
    const g = useChat.getState().messages.filter((m) => m.reply_to === 101);
    expect(g.map((m) => m.active)).toEqual([true, false]);
  });

  it("editResend：先截断（本地与后端）再重新生成", async () => {
    vi.mocked(api.chatEditTruncate).mockResolvedValue({ ...userMsg, content: "改过" });
    vi.mocked(api.chatRegenerate).mockResolvedValue(userMsg);
    const later: ChatMessage = { ...userMsg, id: 104, content: "后续" };
    await init([userMsg, aiMsg, later]);
    await useChat.getState().editResend(101, "改过");
    expect(api.chatEditTruncate).toHaveBeenCalledWith(101, "改过");
    expect(api.chatRegenerate).toHaveBeenCalledWith(101, expect.anything());
    expect(useChat.getState().messages.map((m) => m.id)).toEqual([101]);
    expect(useChat.getState().messages[0].content).toBe("改过");
  });

  it("新会话 / 删除当前会话后打开下一个", async () => {
    vi.mocked(api.sessionCreate).mockResolvedValue(session2);
    await init([], [session]);
    await useChat.getState().newSession();
    expect(useChat.getState().sessionId).toBe(8);
    expect(useChat.getState().sessions.map((s) => s.id)).toEqual([8, 7]);
    vi.mocked(api.sessionDelete).mockResolvedValue(undefined);
    await useChat.getState().deleteSession(8);
    expect(useChat.getState().sessionId).toBe(7);
  });

  it("agent 后端分流：发送/停止/重新生成走 ACP 命令；agent://turn 失败走错误路径", async () => {
    useAgents.setState({ backend: "agent:claude" });
    vi.mocked(api.sendMessageAcp).mockResolvedValue(userMsg);
    vi.mocked(api.chatRegenerateAcp).mockResolvedValue(userMsg);
    await init();
    await useChat.getState().send("续写一段");
    expect(api.sendMessageAcp).toHaveBeenCalledWith(7, "续写一段", expect.any(Object));
    expect(api.sendMessage).not.toHaveBeenCalled();
    emit("agent://stream", { session_id: 999, text: "别处" });
    emit("agent://stream", { session_id: 7, text: "夜色" });
    expect(useChat.getState().streamText).toBe("夜色");
    await useChat.getState().stop();
    expect(api.cancelGenerationAcp).toHaveBeenCalledWith(7);
    emit("agent://turn", { session_id: 7, ok: false, content: null, error: "agent 启动失败" });
    expect(useChat.getState().error).toBe("agent 启动失败");
    await useChat.getState().regenerate(101);
    expect(api.chatRegenerateAcp).toHaveBeenCalledWith(101, expect.any(Object));
  });

  it("agent://permission 匹配会话才置卡；respondPermission 清卡并应答", async () => {
    await init();
    const perm = { session_id: 7, request_id: "r1", title: "读取文件", options: [] };
    emit("agent://permission", { ...perm, session_id: 999 });
    expect(useChat.getState().permission).toBeNull();
    emit("agent://permission", perm);
    expect(useChat.getState().permission).toEqual(perm);
    await useChat.getState().respondPermission("allow_once");
    expect(useChat.getState().permission).toBeNull();
    expect(api.agentsRespondPermission).toHaveBeenCalledWith(7, "r1", "allow_once");
  });

  it("buildTurnOptions：同章活动编辑器给出光标前后文", async () => {
    await init();
    useWorkspace.setState({ activePane: "a" });
    const bridge = {
      chapterId: 11,
      getContext: () => ({ chapterId: 11, before: "光标前", after: "光标后", selection: "", from: 3, to: 3 }),
    } as unknown as EditorBridge;
    const off = registerEditorBridge("a", bridge);
    expect(buildTurnOptions({})).toMatchObject({ cursor_before: "光标前", cursor_after: "光标后", mode: "write" });
    off();
    expect(buildTurnOptions({})).toMatchObject({ cursor_before: null, cursor_after: null });
  });

  it("流式中或空指令时 send 拒绝", async () => {
    vi.mocked(api.sendMessage).mockResolvedValue(userMsg);
    await init();
    expect(await useChat.getState().send("   ")).toBe(false);
    await useChat.getState().send("一");
    expect(await useChat.getState().send("二")).toBe(false);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
