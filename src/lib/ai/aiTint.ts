import { kvGet, kvSet } from "../kv";
import { splitParas } from "./paraDiff";

// AI 写入着色（阶段 2B）：采纳进正文的段落记下来（按章存 settings），编辑器里淡淡标底色；
// 用户改过一个字，该段就不再与记录相同，底色随之消失——「改过的就是你的了」。
// 只是装饰，落盘的 Markdown 不带任何标记。

const key = (chapterId: number) => `ai_tint:${chapterId}`;
/** 太短的片段（「好。」）满篇都是，不记 */
const MIN_LEN = 4;
const MAX_SNIPPETS = 300;

export async function loadTint(chapterId: number): Promise<string[]> {
  try {
    const v = await kvGet<string[]>(key(chapterId));
    return Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

/** 记下新采纳的文本（按段），返回该章完整的片段表 */
export async function addTint(chapterId: number, text: string | string[]): Promise<string[]> {
  const paras = (Array.isArray(text) ? text : splitParas(text)).filter((p) => p.length >= MIN_LEN);
  const cur = await loadTint(chapterId);
  if (paras.length === 0) return cur;
  const next = [...cur.filter((s) => !paras.includes(s)), ...paras].slice(-MAX_SNIPPETS);
  try {
    await kvSet(key(chapterId), next);
  } catch {
    // 着色是锦上添花：存不上不影响采纳
  }
  return next;
}

/** 去掉正文里已不存在的片段（改过 / 删掉了），有变化才回写 */
export async function pruneTint(chapterId: number, snippets: string[], docText: string): Promise<string[]> {
  const kept = snippets.filter((s) => docText.includes(s));
  if (kept.length !== snippets.length) {
    try {
      await kvSet(key(chapterId), kept);
    } catch {
      // 同上
    }
  }
  return kept;
}
