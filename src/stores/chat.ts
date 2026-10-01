import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  ChatMessage,
  AcpStreamEvent,
  AcpPermissionEvent,
  AcpTurnEvent,
} from "../lib/tauri";
import { useAgents } from "./agents";
import { errCode, errMsg } from "../lib/errors";

// 后端流式事件信封（serde tagged，对应 src-tauri/src/llm/stream.rs 的 StreamEvent）
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; session_id: number; content: string }
  | { type: "error"; message: string };

interface ChatState {
  sessionId: number | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamText: string;
  error: string | null;
  /** 结构化错误码（AppError.code），UI 据此给出处理入口（如「去设置服务商」） */
  errorCode: string | null;
  // ACP 权限请求（一次一张；agent 请求工具授权时置入，应答后清除）
  permission: AcpPermissionEvent | null;
  // 采纳通道：adopt 置入，ChapterEditor 消费后 clearPendingAppend 清空（单一通道）
  pendingAppend: string | null;
  initForChapter: (chapterId: number) => Promise<void>;
  send: (instruction: string) => Promise<boolean>;
  stop: () => Promise<void>;
  adopt: (messageId: number) => Promise<void>;
  deleteMessage: (id: number) => Promise<void>;
  respondPermission: (optionId: string) => Promise<void>;
  clearError: () => void;
  clearPendingAppend: () => void;
  dispose: () => void;
}

// 会话级事件监听：initForChapter 时建立（先于任何 sendMessage 的 invoke，
// 规避「Error 事件先于监听就绪」的时序坑），换章节 / 卸载时解除。
// M2 起 agent:// 三个 ACP 事件与 stream:// 并列同时建立/解除。
let activeUnlistens: Array<() => void> = [];
// 并发 init 竞态序号：快速切换章节时只让最后一次 init 生效
let initSeq = 0;
// 乐观 user 气泡与 done 本地定稿的临时负数 id；随后分别被 sendMessage 返回值
// 与 listMessages 刷新结果替换
let tempIdSeq = 0;

function detachListening() {
  for (const un of activeUnlistens) un();
  activeUnlistens = [];
}

/** 回合落定（provider done / agent turn 共用）：本地定稿 + listMessages 刷新收尾。 */
function finalizeTurn(sessionId: number, content: string | null) {
  useChat.setState((st) => {
    const base = { streaming: false as const, streamText: "", permission: null };
    if (!content) return base;
    return {
      ...base,
      messages: [
        ...st.messages,
        { id: --tempIdSeq, session_id: sessionId, role: "assistant", content, created_at: "" },
      ],
    };
  });
  void (async () => {
    try {
      const msgs = await api.listMessages(sessionId);
      const cur = useChat.getState();
      // 刷新期间若已切换章节或开启新一轮生成，放弃本次结果
      if (cur.sessionId === sessionId && !cur.streaming) {
        useChat.setState({ messages: msgs });
      }
    } catch {
      // 刷新失败保留本地定稿，重新进入章节时会重新拉取
    }
  })();
}

function handleStreamEvent(ev: { payload: StreamEvent }) {
  const p = ev.payload;
  if (p.type === "delta") {
    const s = useChat.getState();
    if (s.streaming) useChat.setState({ streamText: s.streamText + p.text });
    return;
  }
  if (p.type === "error") {
    useChat.setState({ streaming: false, streamText: "", permission: null, error: p.message });
    return;
  }
  // done：先本地定稿（负数临时 id，避免刷新间隙内容闪烁），再以 listMessages 刷新为准
  finalizeTurn(p.session_id, p.content);
}

// ---- ACP 事件（payload 带 session_id，全局广播，须按当前会话过滤） ----

function handleAcpStream(ev: { payload: AcpStreamEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId) return;
  if (s.streaming) useChat.setState({ streamText: s.streamText + p.text });
}

function handleAcpPermission(ev: { payload: AcpPermissionEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId) return;
  useChat.setState({ permission: p }); // 一次一张：后来者覆盖
}

function handleAcpTurn(ev: { payload: AcpTurnEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId) return;
  if (!p.ok) {
    // 复用现有 error 路径（AiDock 红色错误条）
    useChat.setState({ streaming: false, streamText: "", permission: null, error: p.error ?? "agent 回合失败" });
    return;
  }
  finalizeTurn(p.session_id, p.content);
}

/** 当前后端是否 ACP agent 直连（未加载完成时按 provider 路径兜底）。 */
function isAcpBackend(): boolean {
  return (useAgents.getState().backend ?? "").startsWith("agent:");
}

export const useChat = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  streaming: false,
  streamText: "",
  error: null,
  errorCode: null,
  permission: null,
  pendingAppend: null,

  initForChapter: async (chapterId) => {
    const seq = ++initSeq;
    detachListening();
    set({ sessionId: null, messages: [], streaming: false, streamText: "", error: null, errorCode: null, permission: null, pendingAppend: null });
    try {
      const session = await api.getOrCreateSession(chapterId);
      if (seq !== initSeq) return;
      // 先建立监听再拉消息/发送，保证流式事件不漏（provider stream:// 与 agent:// 并列）
      const uns = await Promise.all([
        listen<StreamEvent>(`stream://${session.id}`, handleStreamEvent),
        listen<AcpStreamEvent>("agent://stream", handleAcpStream),
        listen<AcpPermissionEvent>("agent://permission", handleAcpPermission),
        listen<AcpTurnEvent>("agent://turn", handleAcpTurn),
      ]);
      if (seq !== initSeq) {
        for (const un of uns) un();
        return;
      }
      activeUnlistens = uns;
      const messages = await api.listMessages(session.id);
      if (seq !== initSeq) return;
      set({ sessionId: session.id, messages });
    } catch (e) {
      if (seq === initSeq) set({ error: errMsg(e) });
    }
  },

  send: async (instruction) => {
    const { sessionId, streaming } = get();
    const trimmed = instruction.trim();
    if (sessionId == null || streaming || !trimmed) return false;
    // 此时监听必然已就绪（initForChapter 建立），可安全发起生成
    set({ streaming: true, streamText: "", error: null, errorCode: null });
    const tempId = --tempIdSeq;
    set((st) => ({
      messages: [...st.messages, { id: tempId, session_id: sessionId, role: "user", content: trimmed, created_at: "" }],
    }));
    try {
      // 双后端分流：agent:* → ACP 直连（流式走 agent:// 事件）；否则 provider 路径
      const userMsg = isAcpBackend()
        ? await api.sendMessageAcp(sessionId, trimmed)
        : await api.sendMessage(sessionId, trimmed);
      // 用落库记录替换乐观气泡
      set((st) => ({ messages: st.messages.map((m) => (m.id === tempId ? userMsg : m)) }));
      return true;
    } catch (e) {
      // invoke 失败 = 后端未落库（服务商/上下文校验在落库前）：撤掉乐观气泡，输入框由调用方还原
      set((st) => ({
        streaming: false,
        error: errMsg(e),
        errorCode: errCode(e),
        messages: st.messages.filter((m) => m.id !== tempId),
      }));
      return false;
    }
  },

  stop: async () => {
    const { sessionId } = get();
    if (sessionId == null) return;
    try {
      // 后端取消后会对已收增量补发 done/turn，由事件处理器收尾
      if (isAcpBackend()) await api.cancelGenerationAcp(sessionId);
      else await api.cancelGeneration(sessionId);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  adopt: async (messageId) => {
    const msg = get().messages.find((m) => m.id === messageId);
    if (!msg || msg.role !== "assistant") return;
    set({ pendingAppend: msg.content });
    // 正文已接收这段内容，从会话中移除避免同一段内容在正文与会话历史重复；
    // 删除失败不阻塞采纳（重进章节时以服务端为准）
    set((st) => ({ messages: st.messages.filter((m) => m.id !== messageId) }));
    try {
      await api.deleteMessage(messageId);
    } catch {
      // 忽略
    }
  },

  deleteMessage: async (id) => {
    try {
      await api.deleteMessage(id);
      set((st) => ({ messages: st.messages.filter((m) => m.id !== id) }));
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  respondPermission: async (optionId) => {
    const { sessionId, permission } = get();
    if (sessionId == null || !permission) return;
    set({ permission: null }); // 先收卡（超时兜底在 Rust 侧），应答失败也只是日志级
    try {
      await api.agentsRespondPermission(sessionId, permission.request_id, optionId);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  clearError: () => set({ error: null, errorCode: null }),
  clearPendingAppend: () => set({ pendingAppend: null }),
  dispose: () => detachListening(),
}));
