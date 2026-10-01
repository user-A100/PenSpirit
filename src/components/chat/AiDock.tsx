import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Eye, MessageSquarePlus, Pencil, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { buildTurnOptions, useChat } from "../../stores/chat";
import { useSettings } from "../../stores/settings";
import { openMenuAt, type MenuEntry } from "../../stores/menu";
import { confirmDialog, promptDialog } from "../../stores/confirm";
import { api, type AssemblyLog } from "../../lib/tauri";
import { errMsg } from "../../lib/errors";
import { SLASH_COMMANDS } from "../../lib/ai/slashCommands";
import { commandShortcut } from "../../lib/commands";
import { BackendSelector } from "./BackendSelector";
import { ContextPreview } from "./ContextPreview";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

// AI 对话卡（阶段 2A 重建）：顶栏（会话切换 / 写正文·讨论 / 后端模型 / 上下文预览）+
// 消息流 + 输入区。折叠态是一条输入提示条（Ctrl+J 展开）。
interface AiDockProps {
  collapsed: boolean;
  onToggle: () => void;
}

type View = "chat" | "preview" | "help";

const SUGGESTIONS: Array<{ label: string; cmd: string }> = [
  { label: "/续写", cmd: "continue" },
  { label: "/头脑风暴", cmd: "brainstorm" },
  { label: "/总结本章", cmd: "summary" },
  { label: "/检查设定", cmd: "check" },
];

export function AiDock({ collapsed, onToggle }: AiDockProps) {
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const sessions = useChat((s) => s.sessions);
  const sessionId = useChat((s) => s.sessionId);
  const streaming = useChat((s) => s.streaming);
  const error = useChat((s) => s.error);
  const errorCode = useChat((s) => s.errorCode);
  const errorKind = useChat((s) => s.errorKind);
  const lastFailure = useChat((s) => s.lastFailure);
  const mode = useChat((s) => s.mode);
  const { initForChapter, openSession, newSession, renameSession, deleteSession, setMode, clearError, retry, dispose, requestCompose } = useChat.getState();
  const openSettings = useSettings((s) => s.open);
  const [view, setView] = useState<View>("chat");
  const [log, setLog] = useState<AssemblyLog | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // 换章节重新初始化会话；卸载解除事件监听
  useEffect(() => {
    if (currentChapterId != null) void initForChapter(currentChapterId);
    setView("chat");
    setLog(null);
    setPreviewError(null);
    return () => dispose();
  }, [currentChapterId, initForChapter, dispose]);

  const loadPreview = async () => {
    if (sessionId == null || previewLoading) return;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      setLog(await api.previewContext(sessionId, "（预览）", buildTurnOptions({})));
    } catch (e) {
      setPreviewError(errMsg(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  const showLocal = (kind: "context" | "help") => {
    if (kind === "context") {
      setView("preview");
      void loadPreview();
    } else setView("help");
  };

  const current = sessions.find((s) => s.id === sessionId);
  const sessionMenu = (): MenuEntry[] => [
    { type: "label", label: "本章对话" },
    ...sessions.map((s) => ({ label: s.title || "未命名对话", checked: s.id === sessionId, onSelect: () => void openSession(s.id) })),
    { type: "separator" },
    { label: "新对话", icon: MessageSquarePlus, onSelect: () => void newSession() },
    {
      label: "重命名本对话…",
      icon: Pencil,
      disabled: current == null,
      onSelect: async () => {
        if (!current) return;
        const t = await promptDialog({ title: "重命名对话", initial: current.title, confirmLabel: "保存" });
        if (t) await renameSession(current.id, t);
      },
    },
    {
      label: "删除本对话…",
      icon: Trash2,
      danger: true,
      disabled: current == null,
      onSelect: async () => {
        if (!current) return;
        if (await confirmDialog({ title: `删除对话「${current.title}」？`, message: "其中的全部消息会被删除（已采纳进正文的内容不受影响）。", confirmLabel: "删除", danger: true })) {
          await deleteSession(current.id);
        }
      },
    },
  ];

  if (collapsed) {
    return (
      <button
        onClick={onToggle}
        aria-label="展开 AI 对话"
        className="flex h-full min-h-9 w-full items-center gap-2 px-3 text-xs text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-secondary)]"
      >
        <Sparkles size={14} className={`shrink-0 ${streaming ? "animate-pulse text-[color:var(--accent)]" : "text-[color:var(--accent)]"}`} />
        <span className="min-w-0 flex-1 truncate text-left">{streaming ? "AI 正在生成…" : "向 AI 描述这段要怎么写，或输入 / 使用命令"}</span>
        <kbd className="shrink-0 rounded-[4px] px-1 font-sans text-2xs [box-shadow:inset_0_0_0_1px_var(--hairline)]">{commandShortcut("ai.toggle")}</kbd>
        <ChevronUp size={14} className="shrink-0" />
      </button>
    );
  }

  const providerHint = (errorCode === "invalid" && (error ?? "").includes("服务商")) || errorKind === "auth" || errorKind === "quota";

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <div className="flex h-10 shrink-0 items-center gap-1 pl-1.5 pr-2">
        <button
          onClick={onToggle}
          aria-label="收起 AI 对话"
          data-tip="收起"
          data-tip-key={commandShortcut("ai.toggle")}
          className="rounded-[var(--r-control)] p-1 text-[color:var(--text-faint)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-secondary)]"
        >
          <ChevronDown size={14} />
        </button>
        <button
          onClick={(e) => openMenuAt(e.currentTarget, sessionMenu())}
          aria-label="切换对话"
          disabled={currentChapterId == null}
          className="flex min-w-0 items-center gap-1 rounded-[var(--r-control)] px-1.5 py-1 text-ui font-medium text-[color:var(--text-primary)] transition-colors hover:bg-[var(--fill-hover)] disabled:opacity-50"
        >
          <Sparkles size={13} className="shrink-0 text-[color:var(--accent)]" />
          <span className="max-w-[14em] truncate">{current?.title || "AI 对话"}</span>
          {sessions.length > 1 && <span className="shrink-0 text-2xs font-normal text-[color:var(--text-faint)]">{sessions.length}</span>}
          <ChevronDown size={11} className="shrink-0 text-[color:var(--text-faint)]" />
        </button>
        <button
          onClick={() => void newSession()}
          aria-label="新对话"
          data-tip="新对话"
          disabled={currentChapterId == null || streaming}
          className="rounded-[var(--r-control)] p-1 text-[color:var(--text-faint)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
        >
          <MessageSquarePlus size={14} />
        </button>
        <div className="min-w-0 flex-1" />
        {/* 模式：写正文（产出可采纳正文）/ 讨论（自由对话） */}
        <div role="radiogroup" aria-label="对话模式" className="flex shrink-0 items-center rounded-[var(--r-control)] bg-[var(--fill-element)] p-0.5 text-2xs">
          {(["write", "discuss"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              data-tip={m === "write" ? "写正文：直接产出可采纳的正文" : "讨论：聊剧情、人物、设定，可多轮追问"}
              className={`rounded-[4px] px-2 py-0.5 transition-[background-color,color,box-shadow] duration-[var(--dur-md)] ${
                mode === m ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              {m === "write" ? "写正文" : "讨论"}
            </button>
          ))}
        </div>
        <BackendSelector />
        <button
          onClick={() => {
            if (view === "preview") setView("chat");
            else showLocal("context");
          }}
          disabled={sessionId == null}
          aria-label="上下文预览"
          data-tip={view === "preview" ? "返回对话" : "查看本轮注入的上下文"}
          className={`rounded-[var(--r-control)] p-1 transition-colors hover:bg-[var(--fill-hover)] disabled:opacity-40 ${view === "preview" ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]"}`}
        >
          <Eye size={14} />
        </button>
      </div>

      {/* 错误条：分类说明 + 重试 / 去设置 */}
      {error != null && (
        <div role="alert" className="mx-3 mb-1 flex items-start gap-1.5 rounded-[var(--r-control)] bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] px-2.5 py-1.5">
          <span className="min-w-0 flex-1 break-all text-xs leading-relaxed text-[color:var(--danger)]">{error}</span>
          {lastFailure && !providerHint && (
            <button onClick={() => void retry()} className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-[color:var(--accent)] transition-colors hover:bg-[var(--fill-hover)]">
              <RefreshCw size={11} />
              重试
            </button>
          )}
          {providerHint && (
            <button
              onClick={() => {
                clearError();
                openSettings("provider");
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-[color:var(--accent)] transition-colors hover:bg-[var(--fill-hover)]"
            >
              去设置服务商
            </button>
          )}
          <button onClick={clearError} aria-label="关闭错误提示" className="shrink-0 rounded p-0.5 text-[color:var(--danger)] transition-colors hover:bg-[var(--fill-hover)]">
            <X size={12} />
          </button>
        </div>
      )}

      {view === "preview" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between px-3 pt-1">
            <span className="text-2xs text-[color:var(--text-faint)]">本轮将注入的上下文（与输入框上方的胶囊一致）</span>
            <button
              onClick={() => void loadPreview()}
              disabled={previewLoading || sessionId == null}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
            >
              <RefreshCw size={12} className={previewLoading ? "animate-spin" : ""} />
              刷新
            </button>
          </div>
          {previewError != null && <div className="mx-3 mt-2 break-all text-xs text-[color:var(--danger)]">{previewError}</div>}
          <div className="min-h-0 flex-1">
            <ContextPreview log={log} loading={previewLoading} onConfigChanged={() => void loadPreview()} />
          </div>
        </div>
      ) : view === "help" ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-[color:var(--text-secondary)]">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-ui font-medium text-[color:var(--text-primary)]">命令与快捷键</span>
            <button onClick={() => setView("chat")} className="rounded px-1.5 py-0.5 text-[color:var(--accent)] hover:bg-[var(--fill-hover)]">
              返回对话
            </button>
          </div>
          <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
            {SLASH_COMMANDS.map((c) => (
              <div key={c.id} className="contents">
                <span className="font-medium text-[color:var(--text-primary)]">/{c.name}</span>
                <span>{c.desc}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1">
            <span>@</span>
            <span>引用章节 / 人物 / 伏笔 / 情节块 / 大纲</span>
            <span>Ctrl+L</span>
            <span>把正文选区引用到对话（选中文字后也可用气泡菜单）</span>
            <span>Ctrl+J</span>
            <span>显示 / 收起 AI 对话</span>
            <span>↑</span>
            <span>输入框为空时召回上一条</span>
            <span>Shift+Enter</span>
            <span>换行</span>
          </div>
        </div>
      ) : (
        <MessageList
          empty={
            <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
              <Sparkles size={26} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
              <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
                {currentChapterId == null ? "选择一个章节后开始" : mode === "write" ? "描述这段要怎么写，AI 直接产出可采纳的正文" : "聊聊剧情、人物与设定，可以多轮追问"}
              </div>
              {currentChapterId != null && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.cmd}
                      onClick={() => {
                        const c = SLASH_COMMANDS.find((x) => x.id === s.cmd)!;
                        requestCompose(c.template, c.id);
                      }}
                      className="rounded-full px-2.5 py-1 text-2xs text-[color:var(--text-secondary)] transition-colors [box-shadow:inset_0_0_0_1px_var(--hairline)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    onClick={() => requestCompose("@", null)}
                    className="rounded-full px-2.5 py-1 text-2xs text-[color:var(--text-secondary)] transition-colors [box-shadow:inset_0_0_0_1px_var(--hairline)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
                  >
                    @ 引用设定
                  </button>
                </div>
              )}
            </div>
          }
        />
      )}

      {view !== "help" && <Composer onLocal={showLocal} />}
    </div>
  );
}
