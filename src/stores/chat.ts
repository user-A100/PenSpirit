import { create } from "zustand";
import { listen } from "@tauri-apps/api/event";
import {
  api,
  type AcpPermissionEvent,
  type AcpStreamEvent,
  type AcpToolEvent,
  type AcpTurnEvent,
  type AgentToolEntry,
  type FileChange,
  type AiTurnOptions,
  type ChatMessage,
  type ChatSession,
  type MentionRef,
} from "../lib/tauri";
import { errCode, errMsg } from "../lib/errors";
import { toast } from "./toast";
import { syncAfterAgentChanges } from "../lib/ai/agentFiles";
import { getActiveEditor } from "../lib/editorBridge";
import { useAgents } from "./agents";

// AI 对话状态机（阶段 2A 重写）：
// - 一章多会话（最近使用在前），会话随章切换；
// - 多轮：历史由后端按模式预算注入；写正文 / 讨论两模式；
// - 本轮上下文：光标前后文（编辑器桥）、引用选区、@ 引用、关闭的槽位、长度、温度；
// - 重新生成保留版本（reply_to 分组 + active），编辑重发截断其后对话；
// - 错误分类与重试；出错前已生成的半截由后端落库（meta.truncated）。

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; session_id: number; content: string }
  | { type: "error"; message: string; kind?: string; partial?: string };

export type ChatMode = "write" | "discuss";
export interface MentionItem extends MentionRef {
  label: string;
}
/** 发送时引用的编辑器选区（替换采纳要回到这里） */
export interface QuoteRef {
  chapterId: number;
  text: string;
  from: number;
  to: number;
}

type LastFailure =
  | { kind: "send"; instruction: string; command: string | null }
  | { kind: "regenerate"; userMessageId: number };

export interface SendExtra {
  command?: string | null;
  mode?: ChatMode;
  targetChars?: number | null;
  disable?: string[];
  /** 阶段 2B：重试选项（更长 / 更短 / 换写法…），追加在指令后、不落库 */
  retryHint?: string | null;
  /** 阶段 2B：多候选（本轮共生成几版） */
  candidates?: number;
}

const CANDIDATES_KEY = "bixian.chat.candidates";
function loadCandidates(): number {
  try {
    const n = Number(localStorage.getItem(CANDIDATES_KEY));
    return n === 2 || n === 3 ? n : 1;
  } catch {
    return 1;
  }
}

/** 阶段 2B：这条回答属于几版并排的候选（meta.candidates） */
export function messageCandidates(m: ChatMessage): number {
  const c = parseMeta(m).candidates;
  return typeof c === "number" ? c : 1;
}
/** 阶段 2B：这版是按什么重试选项生成的（meta.retry） */
export function messageRetry(m: ChatMessage): string | null {
  const r = parseMeta(m).retry;
  return typeof r === "string" ? r : null;
}

interface ChatPrefs {
  mode: ChatMode;
  targetChars: number | null;
  temperature: number | null;
  /** 采纳前清洗（去开场白 / Markdown 记号） */
  clean: boolean;
}

const PREFS_KEY = "bixian.chat.prefs";

function loadPrefs(): ChatPrefs {
  const d: ChatPrefs = { mode: "write", targetChars: null, temperature: null, clean: true };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      mode: raw.mode === "discuss" ? "discuss" : "write",
      targetChars: typeof raw.targetChars === "number" && raw.targetChars > 0 ? raw.targetChars : null,
      temperature: typeof raw.temperature === "number" ? raw.temperature : null,
      clean: raw.clean !== false,
    };
  } catch {
    return d;
  }
}

function savePrefs(p: ChatPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // 持久化失败不影响会话内
  }
}

/** 错误类别 → 给人看的说明（重试按钮另给） */
export function friendlyError(kind: string | null | undefined, message: string): string {
  switch (kind) {
    case "auth":
      return "鉴权失败：API Key 无效或没有权限，请检查服务商设置。";
    case "quota":
      return "额度或余额不足，请到服务商处充值或换一个服务商。";
    case "rate_limit":
      return "请求太频繁（被限流），稍等几秒再试。";
    case "context_length":
      return "上下文超长：在输入框上方关掉部分上下文，或缩短选区后再试。";
    case "network":
      return "网络连接失败，请检查网络或服务商地址。";
    case "server":
      return "服务商暂时不可用（服务端错误），稍后重试。";
    default:
      return message;
  }
}

interface ChatState {
  chapterId: number | null;
  sessions: ChatSession[];
  sessionId: number | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamText: string;
  /** 正在生成的回答针对的 user 消息（新一轮在后端返回前为 null） */
  streamReplyTo: number | null;
  error: string | null;
  errorCode: string | null;
  errorKind: string | null;
  lastFailure: LastFailure | null;
  // ACP 权限请求（一次一张；agent 请求工具授权时置入，应答后清除）
  permission: AcpPermissionEvent | null;
  /** 阶段 2B：排在当前这张之后的权限请求（agent 可能一口气请求好几项） */
  permissionQueue: AcpPermissionEvent[];
  /** 阶段 2B：本会话一直允许的工具类别（sessionId → kinds；只在内存里，关掉应用即失效） */
  autoAllow: Record<number, string[]>;
  clearAutoAllow: () => void;
  /** 阶段 2B：进行中的 agent 回合的工具调用（实时） */
  streamTools: AgentToolEntry[];
  /** 阶段 2B：撤销 / 恢复某个 agent 回合对书文件的全部改动 */
  undoAgentTurn: (messageId: number) => Promise<void>;
  // —— 本轮上下文 ——
  mode: ChatMode;
  targetChars: number | null;
  temperature: number | null;
  clean: boolean;
  disabledSlots: string[];
  /** 阶段 2B：本轮手选的写作规则（切会话清空） */
  manualRules: number[];
  toggleRule: (id: number) => void;
  /** 阶段 2B：记忆 / 规则 / 注入设置改了 → 输入区胶囊重取一次组装日志 */
  previewSeq: number;
  requestPreviewRefresh: () => void;
  mentions: MentionItem[];
  quote: QuoteRef | null;
  quoteByMessage: Record<number, QuoteRef>;
  commandByMessage: Record<number, string>;
  /** 外部预填输入框的请求（气泡菜单「改写…」/ Ctrl+L）：Composer 消费 */
  compose: { text: string; command: string | null; seq: number } | null;

  initForChapter: (chapterId: number) => Promise<void>;
  requestCompose: (text: string, command: string | null) => void;
  openSession: (id: number) => Promise<void>;
  newSession: () => Promise<void>;
  renameSession: (id: number, title: string) => Promise<void>;
  deleteSession: (id: number) => Promise<void>;
  send: (instruction: string, extra?: SendExtra) => Promise<boolean>;
  regenerate: (userMessageId: number, opts?: { retryHint?: string | null; candidates?: number }) => Promise<boolean>;
  /** 阶段 2B：多候选——每轮生成几版（1 / 2 / 3），并排对比 */
  candidates: number;
  setCandidates: (n: number) => void;
  /** 进行中的多候选：还要再生成几版 */
  pendingCandidates: { userMessageId: number; remaining: number; total: number } | null;
  /** 阶段 2B：会话管理 */
  forkSession: (uptoMessageId: number) => Promise<void>;
  setSessionPinned: (id: number, pinned: boolean) => Promise<void>;
  setSessionArchived: (id: number, archived: boolean) => Promise<void>;
  starMessage: (id: number, starred: boolean) => Promise<void>;
  /** 搜索结果跳转：切到该章后打开这个会话（initForChapter 消费） */
  openAfterInit: number | null;
  editResend: (userMessageId: number, content: string) => Promise<boolean>;
  switchVariant: (messageId: number) => Promise<void>;
  stop: () => Promise<void>;
  retry: () => Promise<void>;
  deleteMessage: (id: number) => Promise<void>;
  markAdopted: (id: number, adopted: boolean) => Promise<void>;
  /** always = 本会话内同类操作以后都自动允许 */
  respondPermission: (optionId: string, opts?: { always?: boolean }) => Promise<void>;
  setMode: (mode: ChatMode) => void;
  setTargetChars: (n: number | null) => void;
  setTemperature: (t: number | null) => void;
  setClean: (v: boolean) => void;
  toggleSlot: (name: string) => void;
  addMention: (m: MentionItem) => void;
  removeMention: (m: MentionRef) => void;
  setQuote: (q: QuoteRef | null) => void;
  clearError: () => void;
  dispose: () => void;
}

// 会话级事件监听：openSession 时建立（先于任何发送，规避「事件先于监听就绪」），切换/卸载时解除。
let activeUnlistens: Array<() => void> = [];
let initSeq = 0;
let tempIdSeq = 0;

function detachListening() {
  for (const un of activeUnlistens) un();
  activeUnlistens = [];
}

function isAcpBackend(): boolean {
  return (useAgents.getState().backend ?? "").startsWith("agent:");
}

function parseMeta(m: ChatMessage): Record<string, unknown> {
  try {
    return JSON.parse(m.meta ?? "{}");
  } catch {
    return {};
  }
}

export function messageMode(m: ChatMessage): ChatMode {
  return parseMeta(m).mode === "discuss" ? "discuss" : "write";
}

export function messageCommand(m: ChatMessage): string | null {
  const c = parseMeta(m).command;
  return typeof c === "string" ? c : null;
}

export function isTruncated(m: ChatMessage): boolean {
  return parseMeta(m).truncated === true;
}

/** 阶段 2B：agent 回答的工具调用与文件改动（非 agent 回答返回 null） */
export interface AgentRecord {
  tools: AgentToolEntry[];
  changes: FileChange[];
  undone: boolean;
  canUndo: boolean;
}
export function messageAgent(m: ChatMessage): AgentRecord | null {
  const meta = parseMeta(m);
  if (meta.backend !== "agent") return null;
  const undone = meta.undone === true;
  return {
    tools: Array.isArray(meta.tools) ? (meta.tools as AgentToolEntry[]) : [],
    changes: Array.isArray(meta.changes) ? (meta.changes as FileChange[]) : [],
    undone,
    canUndo: typeof (undone ? meta.redo : meta.undo) === "string",
  };
}

/** 权限请求里「允许」的那个选项（优先「仅这次」） */
function allowOption(p: AcpPermissionEvent) {
  return p.options.find((o) => o.kind === "allow_once") ?? p.options.find((o) => o.kind.startsWith("allow"));
}

/** 刷新消息列表（以服务端为准）；期间切了会话或又开始生成则放弃 */
async function refresh(sessionId: number) {
  try {
    const msgs = await api.listMessages(sessionId);
    const cur = useChat.getState();
    if (cur.sessionId === sessionId && !cur.streaming) useChat.setState({ messages: msgs });
  } catch {
    // 刷新失败保留本地态，重新进入时会重新拉取
  }
}

async function refreshSessions(chapterId: number) {
  try {
    const sessions = await api.listSessions(chapterId);
    if (useChat.getState().chapterId === chapterId) useChat.setState({ sessions });
  } catch {
    // 忽略
  }
}

/** 回合落定（provider done / agent turn 共用）：本地定稿 + 刷新收尾 */
function finalizeTurn(sessionId: number, content: string | null) {
  useChat.setState((st) => {
    const base = { streaming: false as const, streamText: "", permission: null, permissionQueue: [], streamTools: [] };
    if (!content) return base;
    const replyTo = st.streamReplyTo;
    const messages = st.messages.map((m) => (replyTo != null && m.reply_to === replyTo ? { ...m, active: false } : m));
    messages.push({ id: --tempIdSeq, session_id: sessionId, role: "assistant", content, created_at: "", reply_to: replyTo, active: true, adopted: false, meta: JSON.stringify({ mode: st.mode }) });
    return { ...base, messages };
  });
  void refresh(sessionId).then(() => {
    // 多候选：本版落定后接着生成下一版（同一问题的新版本）
    const st = useChat.getState();
    const pc = st.pendingCandidates;
    if (!pc || st.streaming || st.sessionId !== sessionId) return;
    if (pc.remaining <= 0) {
      useChat.setState({ pendingCandidates: null });
      return;
    }
    useChat.setState({ pendingCandidates: { ...pc, remaining: pc.remaining - 1 } });
    void st.regenerate(pc.userMessageId, { candidates: pc.total }).then((ok) => {
      if (!ok) useChat.setState({ pendingCandidates: null });
    });
  });
}

function failTurn(sessionId: number, message: string, kind: string | null, partial: string | null) {
  const st = useChat.getState();
  useChat.setState({
    pendingCandidates: null,
    streaming: false,
    streamText: "",
    permission: null,
    permissionQueue: [],
    streamTools: [],
    error: friendlyError(kind, message),
    errorKind: kind,
    errorCode: null,
    lastFailure: st.streamReplyTo != null ? { kind: "regenerate", userMessageId: st.streamReplyTo } : null,
  });
  if (partial) void refresh(sessionId);
}

function handleStreamEvent(ev: { payload: StreamEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.type === "delta") {
    if (s.streaming) useChat.setState({ streamText: s.streamText + p.text });
    return;
  }
  if (s.sessionId == null) return;
  if (p.type === "error") {
    failTurn(s.sessionId, p.message, p.kind ?? null, p.partial ?? null);
    return;
  }
  finalizeTurn(p.session_id, p.content);
}

function handleAcpStream(ev: { payload: AcpStreamEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId) return;
  if (s.streaming) useChat.setState({ streamText: s.streamText + p.text });
}

function handleAcpTool(ev: { payload: AcpToolEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId || !s.streaming) return;
  const has = s.streamTools.some((t) => t.id === p.tool.id);
  useChat.setState({ streamTools: has ? s.streamTools.map((t) => (t.id === p.tool.id ? p.tool : t)) : [...s.streamTools, p.tool] });
}

function handleAcpPermission(ev: { payload: AcpPermissionEvent }) {
  const p = ev.payload;
  const s = useChat.getState();
  if (p.session_id !== s.sessionId) return;
  // 本会话已设「一直允许」的类别：直接应答，不弹卡
  const opt = allowOption(p);
  if (opt && (s.autoAllow[p.session_id] ?? []).includes(p.tool_kind ?? "other")) {
    toast.info(`已按本会话设置自动允许：${p.title}`);
    void api.agentsRespondPermission(p.session_id, p.request_id, opt.option_id).catch((e) => useChat.setState({ error: errMsg(e) }));
    return;
  }
  useChat.setState((st) => (st.permission ? { permissionQueue: [...st.permissionQueue, p] } : { permission: p }));
}

function handleAcpTurn(ev: { payload: AcpTurnEvent }) {
  const p = ev.payload;
  if (p.session_id !== useChat.getState().sessionId) return;
  if (p.changes?.length) void syncAfterAgentChanges(p.changes);
  if (!p.ok) {
    failTurn(p.session_id, p.error ?? "agent 回合失败", null, p.content);
    return;
  }
  finalizeTurn(p.session_id, p.content);
}

async function attach(sessionId: number): Promise<Array<() => void>> {
  return Promise.all([
    listen<StreamEvent>(`stream://${sessionId}`, handleStreamEvent),
    listen<AcpStreamEvent>("agent://stream", handleAcpStream),
    listen<AcpPermissionEvent>("agent://permission", handleAcpPermission),
    listen<AcpTurnEvent>("agent://turn", handleAcpTurn),
    listen<AcpToolEvent>("agent://tool", handleAcpTool),
  ]);
}

/** 组装本轮选项：光标前后文取活动编辑器（与对话同章时）。Composer 的上下文胶囊也用它，所见即所发 */
export function buildTurnOptions(extra: SendExtra & { quote?: QuoteRef | null }): AiTurnOptions {
  const st = useChat.getState();
  const ed = getActiveEditor();
  const ctx = ed && ed.chapterId === st.chapterId ? ed.getContext() : null;
  const mode = extra.mode ?? st.mode;
  const quote = extra.quote !== undefined ? extra.quote : st.quote;
  const disabled = [...new Set([...st.disabledSlots, ...(extra.disable ?? [])])];
  return {
    mode,
    cursor_before: ctx ? ctx.before : null,
    cursor_after: ctx ? ctx.after : null,
    selection: quote?.text ?? null,
    disabled_slots: disabled,
    mentions: st.mentions.map(({ kind, id }) => ({ kind, id })),
    target_chars: extra.targetChars !== undefined ? extra.targetChars : st.targetChars,
    temperature: st.temperature,
    command: extra.command ?? null,
    rules: st.manualRules,
    retry_hint: extra.retryHint ?? null,
    candidates: extra.candidates && extra.candidates > 1 ? extra.candidates : null,
  };
}

const prefs = loadPrefs();

export const useChat = create<ChatState>((set, get) => ({
  chapterId: null,
  sessions: [],
  sessionId: null,
  messages: [],
  streaming: false,
  streamText: "",
  streamReplyTo: null,
  error: null,
  errorCode: null,
  errorKind: null,
  lastFailure: null,
  permission: null,
  mode: prefs.mode,
  targetChars: prefs.targetChars,
  temperature: prefs.temperature,
  clean: prefs.clean,
  disabledSlots: [],
  manualRules: [],
  candidates: loadCandidates(),
  setCandidates: (n) => {
    const v = n === 2 || n === 3 ? n : 1;
    set({ candidates: v });
    try {
      localStorage.setItem(CANDIDATES_KEY, String(v));
    } catch {
      // 忽略
    }
  },
  pendingCandidates: null,
  openAfterInit: null,
  permissionQueue: [],
  autoAllow: {},
  streamTools: [],
  clearAutoAllow: () => {
    const sid = get().sessionId;
    if (sid != null) set((st) => ({ autoAllow: { ...st.autoAllow, [sid]: [] } }));
  },
  undoAgentTurn: async (messageId) => {
    try {
      const r = await api.agentUndoTurn(messageId);
      const sid = get().sessionId;
      if (sid != null) await refresh(sid);
      await syncAfterAgentChanges(r.changes);
      toast.success(r.undone ? `已撤销 AI 对 ${r.changes.length} 个文件的改动` : "已恢复 AI 的改动");
    } catch (e) {
      toast.error(`撤销失败：${errMsg(e)}`);
    }
  },
  forkSession: async (uptoMessageId) => {
    const sid = get().sessionId;
    if (sid == null || uptoMessageId < 0) return;
    try {
      const s = await api.sessionFork(sid, uptoMessageId);
      set((st) => ({ sessions: [s, ...st.sessions.filter((x) => x.id !== s.id)] }));
      await get().openSession(s.id);
      toast.success(`已分叉为「${s.title}」`);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
  setSessionPinned: async (id, pinned) => {
    try {
      await api.sessionSetPinned(id, pinned);
      const chapterId = get().chapterId;
      if (chapterId != null) await refreshSessions(chapterId);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
  setSessionArchived: async (id, archived) => {
    try {
      await api.sessionSetArchived(id, archived);
      const chapterId = get().chapterId;
      if (chapterId != null) await refreshSessions(chapterId);
      // 归档当前会话：换到最近一个未归档的（没有就新建）
      if (archived && get().sessionId === id) {
        const next = get().sessions.find((s) => !s.archived && s.id !== id);
        if (next) await get().openSession(next.id);
        else await get().newSession();
      }
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
  starMessage: async (id, starred) => {
    try {
      await api.messageStar(id, starred);
      set((st) => ({ messages: st.messages.map((m) => (m.id === id ? { ...m, starred } : m)) }));
      if (starred) toast.success("已收藏，并存进素材库「AI 收藏」");
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },
  previewSeq: 0,
  requestPreviewRefresh: () => set((st) => ({ previewSeq: st.previewSeq + 1 })),
  mentions: [],
  quote: null,
  quoteByMessage: {},
  commandByMessage: {},
  compose: null,

  requestCompose: (text, command) => set((st) => ({ compose: { text, command, seq: (st.compose?.seq ?? 0) + 1 } })),

  initForChapter: async (chapterId) => {
    const seq = ++initSeq;
    detachListening();
    set({
      chapterId, sessions: [], sessionId: null, messages: [], streaming: false, streamText: "", streamReplyTo: null,
      error: null, errorCode: null, errorKind: null, lastFailure: null, permission: null, permissionQueue: [], streamTools: [],
      disabledSlots: [], manualRules: [], mentions: [], quote: null,
    });
    try {
      let sessions = await api.listSessions(chapterId);
      if (seq !== initSeq) return;
      if (sessions.length === 0) {
        sessions = [await api.getOrCreateSession(chapterId)];
        if (seq !== initSeq) return;
      }
      // 搜索跳转指定的会话优先；否则最近一个未归档的
      const want = get().openAfterInit;
      const session = sessions.find((s) => s.id === want) ?? sessions.find((s) => !s.archived) ?? sessions[0];
      if (want != null) set({ openAfterInit: null });
      const uns = await attach(session.id);
      if (seq !== initSeq) {
        for (const un of uns) un();
        return;
      }
      activeUnlistens = uns;
      const messages = await api.listMessages(session.id);
      if (seq !== initSeq) return;
      set({ sessions, sessionId: session.id, messages });
    } catch (e) {
      if (seq === initSeq) set({ error: errMsg(e), errorCode: errCode(e) });
    }
  },

  openSession: async (id) => {
    if (get().streaming) await get().stop();
    const seq = ++initSeq;
    detachListening();
    set({ sessionId: id, messages: [], streamText: "", streaming: false, streamReplyTo: null, error: null, lastFailure: null });
    try {
      const uns = await attach(id);
      if (seq !== initSeq) {
        for (const un of uns) un();
        return;
      }
      activeUnlistens = uns;
      const messages = await api.listMessages(id);
      if (seq === initSeq) set({ messages });
    } catch (e) {
      if (seq === initSeq) set({ error: errMsg(e) });
    }
  },

  newSession: async () => {
    const chapterId = get().chapterId;
    if (chapterId == null) return;
    try {
      const s = await api.sessionCreate(chapterId);
      set((st) => ({ sessions: [s, ...st.sessions.filter((x) => x.id !== s.id)] }));
      await get().openSession(s.id);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  renameSession: async (id, title) => {
    try {
      const s = await api.sessionRename(id, title);
      set((st) => ({ sessions: st.sessions.map((x) => (x.id === id ? s : x)) }));
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  deleteSession: async (id) => {
    try {
      await api.sessionDelete(id);
    } catch (e) {
      set({ error: errMsg(e) });
      return;
    }
    const rest = get().sessions.filter((s) => s.id !== id);
    set({ sessions: rest });
    if (get().sessionId === id) {
      if (rest.length > 0) await get().openSession(rest[0].id);
      else await get().newSession();
    }
  },

  send: async (instruction, extra = {}) => {
    const { sessionId, streaming } = get();
    const text = instruction.trim();
    if (sessionId == null || streaming || !text) return false;
    const quote = get().quote;
    // 多候选只用于产出正文 / 讨论回答；本地与「继续写」类命令不并排
    const n = extra.candidates ?? (extra.command === "continue-reply" || extra.command === "compact" || extra.command === "directions" ? 1 : get().candidates);
    const options = buildTurnOptions({ ...extra, quote, candidates: n });
    set({ streaming: true, streamText: "", streamTools: [], streamReplyTo: null, error: null, errorCode: null, errorKind: null, lastFailure: null });
    const tempId = --tempIdSeq;
    set((st) => ({
      messages: [...st.messages, { id: tempId, session_id: sessionId, role: "user", content: text, created_at: "", meta: "{}" }],
    }));
    try {
      const userMsg = isAcpBackend()
        ? await api.sendMessageAcp(sessionId, text, options)
        : await api.sendMessage(sessionId, text, options);
      set((st) => ({
        messages: st.messages.map((m) => (m.id === tempId ? userMsg : m)),
        streamReplyTo: userMsg.id,
        quoteByMessage: quote ? { ...st.quoteByMessage, [userMsg.id]: quote } : st.quoteByMessage,
        commandByMessage: extra.command ? { ...st.commandByMessage, [userMsg.id]: extra.command } : st.commandByMessage,
        // 本轮上下文用过即清（@ 引用 / 引用选区 / 关闭的槽位都是「这一轮」的）
        mentions: [],
        quote: null,
        disabledSlots: [],
        manualRules: [],
        pendingCandidates: n > 1 ? { userMessageId: userMsg.id, remaining: n - 1, total: n } : null,
      }));
      const chapterId = get().chapterId;
      if (chapterId != null) void refreshSessions(chapterId);
      return true;
    } catch (e) {
      // invoke 失败 = 后端未落库：撤回乐观气泡，输入框由调用方还原
      set((st) => ({
        streaming: false,
        error: errMsg(e),
        errorCode: errCode(e),
        errorKind: null,
        lastFailure: { kind: "send", instruction: text, command: extra.command ?? null },
        messages: st.messages.filter((m) => m.id !== tempId),
      }));
      return false;
    }
  },

  regenerate: async (userMessageId, extra = {}) => {
    const { sessionId, streaming, messages } = get();
    if (sessionId == null || streaming) return false;
    const prior = messages.find((m) => m.reply_to === userMessageId && m.active !== false);
    const mode = prior ? messageMode(prior) : get().mode;
    const command = get().commandByMessage[userMessageId] ?? (prior ? messageCommand(prior) : null);
    const options = buildTurnOptions({ mode, command, quote: get().quoteByMessage[userMessageId] ?? null, retryHint: extra.retryHint ?? null, candidates: extra.candidates });
    set({ streaming: true, streamText: "", streamTools: [], streamReplyTo: userMessageId, error: null, errorKind: null, lastFailure: null });
    try {
      if (isAcpBackend()) await api.chatRegenerateAcp(userMessageId, options);
      else await api.chatRegenerate(userMessageId, options);
      return true;
    } catch (e) {
      set({ streaming: false, error: errMsg(e), errorCode: errCode(e), lastFailure: { kind: "regenerate", userMessageId } });
      return false;
    }
  },

  editResend: async (userMessageId, content) => {
    const text = content.trim();
    const { sessionId, streaming } = get();
    if (sessionId == null || streaming || !text) return false;
    try {
      await api.chatEditTruncate(userMessageId, text);
    } catch (e) {
      set({ error: errMsg(e), errorCode: errCode(e) });
      return false;
    }
    set((st) => ({
      messages: st.messages.filter((m) => m.id <= userMessageId).map((m) => (m.id === userMessageId ? { ...m, content: text } : m)),
    }));
    return get().regenerate(userMessageId);
  },

  switchVariant: async (messageId) => {
    try {
      const m = await api.messageSetActive(messageId);
      set((st) => ({
        messages: st.messages.map((x) => (x.reply_to != null && x.reply_to === m.reply_to ? { ...x, active: x.id === m.id } : x)),
      }));
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  stop: async () => {
    const { sessionId } = get();
    if (sessionId == null) return;
    // 用户叫停：剩下的候选也不再生成
    set({ pendingCandidates: null });
    try {
      // 后端取消后会对已收增量补发 done/turn，由事件处理器收尾
      if (isAcpBackend()) await api.cancelGenerationAcp(sessionId);
      else await api.cancelGeneration(sessionId);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  retry: async () => {
    const f = get().lastFailure;
    if (!f) return;
    set({ error: null, errorKind: null });
    if (f.kind === "send") await get().send(f.instruction, { command: f.command });
    else await get().regenerate(f.userMessageId);
  },

  deleteMessage: async (id) => {
    const msg = get().messages.find((m) => m.id === id);
    try {
      await api.deleteMessage(id);
      // 删问题会级联删掉它的全部回答版本
      set((st) => ({ messages: st.messages.filter((m) => m.id !== id && !(msg?.role === "user" && m.reply_to === id)) }));
      const sid = get().sessionId;
      if (msg?.role === "assistant" && sid != null) void refresh(sid);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  markAdopted: async (id, adopted) => {
    set((st) => ({ messages: st.messages.map((m) => (m.id === id ? { ...m, adopted } : m)) }));
    try {
      await api.messageSetAdopted(id, adopted);
    } catch {
      // 标记失败不影响正文（采纳已发生）
    }
  },

  respondPermission: async (optionId, opts) => {
    const { sessionId, permission } = get();
    if (sessionId == null || !permission) return;
    // 「本会话一直允许」：记下类别，队列里同类的请求一并放行
    let auto: AcpPermissionEvent[] = [];
    if (opts?.always) {
      const kind = permission.tool_kind ?? "other";
      auto = get().permissionQueue.filter((q) => (q.tool_kind ?? "other") === kind && allowOption(q));
      set((st) => ({ autoAllow: { ...st.autoAllow, [sessionId]: [...new Set([...(st.autoAllow[sessionId] ?? []), kind])] } }));
    }
    const rest = get().permissionQueue.filter((q) => !auto.includes(q));
    set({ permission: rest[0] ?? null, permissionQueue: rest.slice(1) }); // 先收卡（超时兜底在 Rust 侧），应答失败也只是日志级
    try {
      await api.agentsRespondPermission(sessionId, permission.request_id, optionId);
      for (const q of auto) await api.agentsRespondPermission(sessionId, q.request_id, allowOption(q)!.option_id);
    } catch (e) {
      set({ error: errMsg(e) });
    }
  },

  setMode: (mode) => {
    set({ mode });
    savePrefs({ mode, targetChars: get().targetChars, temperature: get().temperature, clean: get().clean });
  },
  setTargetChars: (targetChars) => {
    set({ targetChars });
    savePrefs({ mode: get().mode, targetChars, temperature: get().temperature, clean: get().clean });
  },
  setTemperature: (temperature) => {
    set({ temperature });
    savePrefs({ mode: get().mode, targetChars: get().targetChars, temperature, clean: get().clean });
  },
  setClean: (clean) => {
    set({ clean });
    savePrefs({ mode: get().mode, targetChars: get().targetChars, temperature: get().temperature, clean });
  },
  toggleRule: (id) => set((st) => ({ manualRules: st.manualRules.includes(id) ? st.manualRules.filter((x) => x !== id) : [...st.manualRules, id] })),
  toggleSlot: (name) =>
    set((st) => ({ disabledSlots: st.disabledSlots.includes(name) ? st.disabledSlots.filter((x) => x !== name) : [...st.disabledSlots, name] })),
  addMention: (m) =>
    set((st) => (st.mentions.some((x) => x.kind === m.kind && x.id === m.id) ? {} : { mentions: [...st.mentions, m] })),
  removeMention: (m) => set((st) => ({ mentions: st.mentions.filter((x) => !(x.kind === m.kind && x.id === m.id)) })),
  setQuote: (quote) => set({ quote }),
  clearError: () => set({ error: null, errorCode: null, errorKind: null }),
  dispose: () => detachListening(),
}));
