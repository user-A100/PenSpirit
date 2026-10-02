import type { SlashCommand } from "./slashCommands";
import { AUTO_VARS, fillTemplate, templateVars } from "./prompts";
import { askVars } from "../../stores/varsDialog";
import { getActiveEditor } from "../editorBridge";
import { useWorkspace } from "../../stores/workspace";
import { useChat } from "../../stores/chat";

/** 自定义命令 → 填好变量的指令文本（内置命令原样返回模板；用户取消变量表单 → null） */
export async function fillCommand(cmd: SlashCommand): Promise<string | null> {
  if (!cmd.custom) return cmd.template;
  const vars = templateVars(cmd.template);
  if (vars.length === 0) return cmd.template;
  const ws = useWorkspace.getState();
  const ed = getActiveEditor();
  const ctx = ed?.getContext();
  const auto: Record<string, string> = {
    选区: useChat.getState().quote?.text ?? ctx?.selection ?? "",
    章名: ws.chapters.find((c) => c.id === ws.currentChapterId)?.title ?? "",
    书名: ws.books.find((b) => b.id === ws.currentBookId)?.title ?? "",
    光标前文: (ctx?.before ?? "").slice(-300),
  };
  const ask = vars.filter((v) => !AUTO_VARS.includes(v));
  let asked: Record<string, string> = {};
  if (ask.length > 0) {
    const r = await askVars(cmd.name, ask);
    if (!r) return null;
    asked = r;
  }
  return fillTemplate(cmd.template, { ...auto, ...asked });
}
