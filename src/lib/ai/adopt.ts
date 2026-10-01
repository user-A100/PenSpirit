import type { ChatMessage } from "../tauri";
import { getActiveEditor } from "../editorBridge";
import { cleanAiText } from "./cleanText";
import { toast } from "../../stores/toast";
import { messageMode, useChat, type QuoteRef } from "../../stores/chat";
import { reviewDiff } from "../../stores/review";

// 采纳（阶段 2A）：插入光标 / 替换选区（先看差异）/ 追加章末；单步可撤销；
// 消息保留并标「已采纳」（不再像 M1 那样采纳即删除）。

export type AdoptHow = "insert" | "replace" | "append";

export async function adoptReply(msg: ChatMessage, how: AdoptHow, quote: QuoteRef | null): Promise<boolean> {
  const ed = getActiveEditor();
  const chat = useChat.getState();
  if (!ed) {
    toast.error("先在编辑区打开一章，再采纳");
    return false;
  }
  if (chat.chapterId != null && ed.chapterId !== chat.chapterId) {
    toast.error("当前编辑的不是这段对话所属的章节");
    return false;
  }
  const prose = messageMode(msg) === "write";
  const text = chat.clean ? cleanAiText(msg.content, { prose }) : msg.content.trim();
  if (!text) return false;

  let ok = false;
  let howDone: AdoptHow = how;
  if (how === "replace") {
    const target = quote ?? (() => {
      const ctx = ed.getContext();
      return ctx.selection ? { chapterId: ed.chapterId, text: ctx.selection, from: ctx.from, to: ctx.to } : null;
    })();
    if (!target) {
      toast.error("没有可替换的选区：先在正文中选中一段，或改用「插入光标处」");
      return false;
    }
    const accepted = await reviewDiff("替换选区 · 预览差异", target.text, text);
    if (!accepted) return false;
    ok = ed.replaceRange(target.from, target.to, target.text, text);
    if (!ok) {
      ok = ed.insertAtCursor(text);
      howDone = "insert";
      if (ok) toast.info("原文已改动、找不到选区，已改为插入到光标处");
    }
  } else if (how === "append") {
    ok = ed.append(text);
  } else {
    ok = ed.insertAtCursor(text);
  }
  if (!ok) {
    toast.error("采纳失败：编辑器不可用");
    return false;
  }
  void chat.markAdopted(msg.id, true);
  const label = howDone === "replace" ? "已替换选区" : howDone === "append" ? "已追加到章末" : "已插入光标处";
  toast.success(label, {
    action: {
      label: "撤销",
      run: () => {
        ed.undo();
        void useChat.getState().markAdopted(msg.id, false);
      },
    },
  });
  return true;
}
