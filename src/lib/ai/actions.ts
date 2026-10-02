import { getActiveEditor } from "../editorBridge";
import { useUiNav } from "../nav/uiStore";
import { findCommand } from "./slashCommands";
import { fillCommand } from "./runPrompt";
import { useChat } from "../../stores/chat";
import { toast } from "../../stores/toast";

// 编辑器 → AI 对话的快捷动作（阶段 2A）：引用选区、选区命令、问 AI。

/** 把活动编辑器的当前选区设为本轮引用；无选区返回 false */
export function quoteSelection(): boolean {
  const ed = getActiveEditor();
  if (!ed) return false;
  const ctx = ed.getContext();
  if (!ctx.selection.trim()) return false;
  useChat.getState().setQuote({ chapterId: ed.chapterId, text: ctx.selection, from: ctx.from, to: ctx.to });
  return true;
}

function openDock() {
  const nav = useUiNav.getState();
  if (nav.aiCollapsed) nav.setAiCollapsed(false);
}

/** 选区斜杠命令：润色/扩写/缩写直接发；改写需补要求 → 预填输入框 */
export async function runSelectionCommand(id: string): Promise<void> {
  const cmd = findCommand(id);
  if (!cmd) return;
  const quoted = quoteSelection();
  if (cmd.needsSelection && !quoted) {
    toast.error("先在正文中选中一段");
    return;
  }
  openDock();
  const chat = useChat.getState();
  if (chat.streaming) {
    toast.info("AI 正在生成，稍后再试");
    return;
  }
  if (id === "rewrite") {
    chat.requestCompose(cmd.template, cmd.id);
    return;
  }
  // 阶段 2B：命令库里的自定义命令——先填变量；没标「选中即发」的放进输入框可补充
  const text = await fillCommand(cmd);
  if (text == null) return;
  if (cmd.custom && !cmd.sendNow) {
    chat.requestCompose(text, cmd.id);
    return;
  }
  await chat.send(text, { command: cmd.id, mode: cmd.mode, targetChars: cmd.targetChars ?? null, disable: cmd.disable, temperature: cmd.temperature, providerId: cmd.providerId });
}

/** 问 AI：引用选区并聚焦输入框（Ctrl+L 同义） */
export function askAiAboutSelection(): void {
  const quoted = quoteSelection();
  openDock();
  useChat.getState().requestCompose("", null);
  if (!quoted) toast.info("没有选中文字：直接输入问题即可");
}
