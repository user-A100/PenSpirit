import { api, type ChatMessage } from "../tauri";
import { useWorkspace } from "../../stores/workspace";
import { toast } from "../../stores/toast";
import { errMsg } from "../errors";
import { plainText } from "./cleanText";
import { runTransient } from "./transient";

// 从回答里抽取设定卡（阶段 2B，Novelcrafter Extract）：AI 只出 JSON → 用户勾选确认 → 落成人物卡 / 伏笔 / 情节块。
export type ExtractKind = "character" | "foreshadow" | "plot";
export const EXTRACT_LABEL: Record<ExtractKind, string> = { character: "人物卡", foreshadow: "伏笔", plot: "情节块" };

export type ExtractItem = Record<string, string>;

/** 宽松解析：去掉 ```json 围栏，取第一个 [ … ] */
export function parseExtraction(text: string): ExtractItem[] {
  const body = text.replace(/```(?:json)?/gi, "");
  const a = body.indexOf("[");
  const b = body.lastIndexOf("]");
  if (a < 0 || b <= a) return [];
  try {
    const v = JSON.parse(body.slice(a, b + 1));
    if (!Array.isArray(v)) return [];
    return v
      .filter((x) => x && typeof x === "object")
      .map((x) => Object.fromEntries(Object.entries(x as Record<string, unknown>).map(([k, val]) => [k, typeof val === "string" ? val : String(val ?? "")])));
  } catch {
    return [];
  }
}

/** 一条候选的显示标题 */
export function itemTitle(kind: ExtractKind, it: ExtractItem): string {
  return kind === "character" ? it.name ?? "" : kind === "foreshadow" ? it.title ?? "" : it.content ?? "";
}

export async function runExtraction(kind: ExtractKind, msg: ChatMessage): Promise<ExtractItem[]> {
  const out = await runTransient({ kind: "extract", extract_kind: kind, text: plainText(msg.content) }).done;
  return parseExtraction(out).filter((it) => itemTitle(kind, it).trim() !== "");
}

/** 把勾选的候选落成卡片；返回创建数 */
export async function createCards(kind: ExtractKind, items: ExtractItem[]): Promise<number> {
  const ws = useWorkspace.getState();
  const bookId = ws.currentBookId;
  if (bookId == null) return 0;
  let n = 0;
  for (const it of items) {
    try {
      if (kind === "character") {
        await api.characterUpsert({ id: null, book_id: bookId, name: it.name.trim(), role: it.role ?? "", aliases: it.aliases ?? "", description: it.description ?? "" });
      } else if (kind === "foreshadow") {
        const planted = ws.currentChapterId ?? ws.chapters[0]?.id;
        if (planted == null) continue;
        await api.foreshadowUpsert({ id: null, book_id: bookId, title: it.title.trim(), planted_chapter_id: planted, target_chapter_id: null, note: it.note ?? "", override_note: "", repay_chapter_id: null });
      } else {
        await api.plotBlockUpsert({ id: null, book_id: bookId, content: it.content.trim(), status: "idea", chapter_id: null, sort_key: 0 });
      }
      n++;
    } catch (e) {
      toast.error(`「${itemTitle(kind, it)}」创建失败：${errMsg(e)}`);
    }
  }
  return n;
}
