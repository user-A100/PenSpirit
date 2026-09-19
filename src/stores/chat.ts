import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import { api, ChatMessage } from "../lib/tauri";

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
  // 采纳通道：adopt 置入，ChapterEditor 消费后 clearPendingAppend 清空（单一通道）
  pendingAppend: string | null;
  initForChapter: (chapterId: number) => Promise<void>;
  send: (instruction: string) => Promise<boolean>;
  stop: () => Promise<void>;
  adopt: (messageId: number) => Promise<void>;
  deleteMessage: (id: number) => Promise<void>;
  clearError: () => void;
  clearPendingAppend: () => void;
  dispose: () => void;
}

// 会话级事件监听：initForChapter 时建立（先于任何 sendMessage 的 invoke，
// 规避「Error 事件先于监听就绪」的时序坑），换章节 / 卸载时解除。
let activeUnlisten: (() => void) | null = null;
// 并发 init 竞态序号：快速切换章节时只让最后一次 init 生效
let initSeq = 0;
// 乐观 user 气泡与 done 本地定稿的临时负数 id；随后分别被 sendMessage 返回值
// 与 listMessages 刷新结果替换
let tempIdSeq = 0;

function detachListening() {
  if (activeUnlisten) {
    activeUnlisten();
    activeUnlisten = null;
  }
}

function handleStreamEvent(ev: { payload: StreamEvent }) {
  const p = ev.payload;
  if (p.type === "delta") {
    const s = useChat.getState();
    if (s.streaming) useChat.setState({ streamText: s.streamText + p.text });
    return;
  }
  if (p.type === "error") {
    useChat.setState({ streaming: false, streamText: "", error: p.message });
    return;
  }
  // done：先本地定稿（负数临时 id，避免刷新间隙内容闪烁），再以 listMessages 刷新为准
  useChat.setState((st) => ({
    streaming: false,
    streamText: "",
    messages: [
      ...st.messages,
      { id: --tempIdSeq, session_id: p.session_id, role: "assistant", content: p.content, created_at: "" },
    ],
  }));
  void (async () => {
    try {
      const msgs = await api.listMessages(p.session_id);
      const cur = useChat.getState();
      // 刷新期间若已切换章节或开启新一轮生成，放弃本次结果
      if (cur.sessionId === p.session_id && !cur.streaming) {
        useChat.setState({ messages: msgs });
      }
    } catch {
      // 刷新失败保留本地定稿，重新进入章节时会重新拉取
    }
  })();
}

export const useChat = create<ChatState>((set, get) => ({
  sessionId: null,
  messages: [],
  streaming: false,
  streamText: "",
  error: null,
  pendingAppend: null,

  initForChapter: async (chapterId) => {
    const seq = ++initSeq;
    detachListening();
    set({ sessionId: null, messages: [], streaming: false, streamText: "", error: null, pendingAppend: null });
    try {
      const session = await api.getOrCreateSession(chapterId);
      if (seq !== initSeq) return;
      // 先建立监听再拉消息/发送，保证流式事件不漏
      const un = await listen<StreamEvent>(`stream://${session.id}`, handleStreamEvent);
      if (seq !== initSeq) {
        un();
        return;
      }
      activeUnlisten = un;
      const messages = await api.listMessages(session.id);
      if (seq !== initSeq) return;
      set({ sessionId: session.id, messages });
    } catch (e) {
      if (seq === initSeq) set({ error: String(e) });
    }
  },

  send: async (instruction) => {
    const { sessionId, streaming } = get();
    const trimmed = instruction.trim();
    if (sessionId == null || streaming || !trimmed) return false;
    // 此时监听必然已就绪（initForChapter 建立），可安全发起生成
    set({ streaming: true, streamText: "", error: null });
    const tempId = --tempIdSeq;
    set((st) => ({
      messages: [...st.messages, { id: tempId, session_id: sessionId, role: "user", content: trimmed, created_at: "" }],
    }));
    try {
      const userMsg = await api.sendMessage(sessionId, trimmed);
      // 用落库记录替换乐观气泡
      set((st) => ({ messages: st.messages.map((m) => (m.id === tempId ? userMsg : m)) }));
      return true;
    } catch (e) {
      set({ streaming: false, error: String(e) });
      return false;
    }
  },

  stop: async () => {
    const { sessionId } = get();
    if (sessionId == null) return;
    try {
      // 后端取消后会对已收增量补发 done，由事件处理器收尾
      await api.cancelGeneration(sessionId);
    } catch (e) {
      set({ error: String(e) });
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
      set({ error: String(e) });
    }
  },

  clearError: () => set({ error: null }),
  clearPendingAppend: () => set({ pendingAppend: null }),
  dispose: () => detachListening(),
}));
