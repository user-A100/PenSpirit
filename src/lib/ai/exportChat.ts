import type { ChatMessage } from "../tauri";
import { fmtFull } from "../time";

// 导出对话为 Markdown（阶段 2C）：只导出每个问题当前选用的那版回答；纯函数，便于测试。

function meta(m: ChatMessage): Record<string, unknown> {
  try {
    return JSON.parse(m.meta ?? "{}");
  } catch {
    return {};
  }
}

export function chatToMarkdown(opts: {
  bookTitle: string;
  chapterTitle: string;
  sessionTitle: string;
  messages: ChatMessage[];
  commandName?: (id: string) => string | undefined;
  now?: Date;
}): string {
  const out: string[] = [`# ${opts.sessionTitle || "AI 对话"}`, "", `> 《${opts.bookTitle}》· ${opts.chapterTitle} · 导出于 ${fmtFull(opts.now ?? new Date())}`, ""];
  for (const m of opts.messages) {
    if (m.id < 0) continue;
    if (m.role === "assistant" && m.active === false) continue;
    const t = fmtFull(m.created_at);
    if (m.role === "user") {
      out.push(`## 我${t ? ` · ${t}` : ""}`, "", m.content.trim(), "");
      continue;
    }
    const mm = meta(m);
    const tags = [mm.mode === "discuss" ? "讨论" : mm.backend === "agent" ? "agent" : "写正文"];
    const cmd = typeof mm.command === "string" ? opts.commandName?.(mm.command) : undefined;
    if (cmd) tags.push(`/${cmd}`);
    if (m.adopted) tags.push("已采纳");
    if (m.starred) tags.push("已收藏");
    if (m.rating === 1) tags.push("👍");
    if (m.rating === -1) tags.push("👎");
    out.push(`## AI${t ? ` · ${t}` : ""}（${tags.join(" · ")}）`, "", m.content.trim(), "");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
