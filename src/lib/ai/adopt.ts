import type { ChatMessage } from "../tauri";
import { getActiveEditor } from "../editorBridge";
import { cleanAiText } from "./cleanText";
import { toast } from "../../stores/toast";
import { messageMode, useChat, type QuoteRef } from "../../stores/chat";
import { reviewDiff } from "../../stores/review";
import { newParagraphs, splitParas } from "./paraDiff";
import { addTint } from "./aiTint";
import { rememberCheckpoint, takeCheckpoint } from "./checkpoint";

// 采纳（阶段 2A）：插入光标 / 替换选区（先看差异）/ 追加章末；单步可撤销；
// 消息保留并标「已采纳」（不再像 M1 那样采纳即删除）。
// 阶段 2B：只采纳回答里选中的部分（partial）；替换时逐段取舍；写入前强制快照（检查点，可「恢复到采纳之前」）；
// 写进正文的段落记进 AI 着色。

export type AdoptHow = "insert" | "replace" | "append";

export async function adoptReply(msg: ChatMessage, how: AdoptHow, quote: QuoteRef | null, partial?: string): Promise<boolean> {
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
  const source = partial?.trim() ? partial : msg.content;
  const text = chat.clean ? cleanAiText(source, { prose }) : source.trim();
  if (!text) return false;

  let ok = false;
  let howDone: AdoptHow = how;
  let fresh: string[] = splitParas(text);
  if (how === "replace") {
    const target = quote ?? (() => {
      const ctx = ed.getContext();
      return ctx.selection ? { chapterId: ed.chapterId, text: ctx.selection, from: ctx.from, to: ctx.to } : null;
    })();
    if (!target) {
      toast.error("没有可替换的选区：先在正文中选中一段，或改用「插入光标处」");
      return false;
    }
    const merged = await reviewDiff(partial ? "替换选区（只用选中部分）· 预览差异" : "替换选区 · 预览差异", target.text, text);
    if (merged == null) return false;
    fresh = newParagraphs(target.text, merged);
    rememberCheckpoint(msg.id, await takeCheckpoint(ed));
    ok = ed.replaceRange(target.from, target.to, target.text, merged);
    if (!ok) {
      ok = ed.insertAtCursor(merged);
      howDone = "insert";
      if (ok) toast.info("原文已改动、找不到选区，已改为插入到光标处");
    }
  } else {
    rememberCheckpoint(msg.id, await takeCheckpoint(ed));
    ok = how === "append" ? ed.append(text) : ed.insertAtCursor(text);
  }
  if (!ok) {
    toast.error("采纳失败：编辑器不可用");
    return false;
  }
  void chat.markAdopted(msg.id, true);
  void addTint(ed.chapterId, fresh).then((sn) => ed.setTint?.(sn));
  const label = howDone === "replace" ? "已替换选区" : howDone === "append" ? "已追加到章末" : "已插入光标处";
  toast.success(partial ? `${label}（选中部分）` : label, {
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
