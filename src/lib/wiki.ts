// wiki 双链纯函数（M7 批次3）：链接是正文里的 `[[章题]]` 纯文本——md 是真源，
// 不加 ProseMirror mark（不污染落盘 markdown），样式与点击由装饰层实现。

export const WIKI_RE = /\[\[([^\[\]]+)\]\]/g;

export interface WikiRange {
  /** 匹配起点在文本内的偏移（含 `[[`） */
  from: number;
  /** 匹配终点（不含，即 `]]` 之后） */
  to: number;
  /** 括号内的目标章题（trim 过） */
  target: string;
}

/** 提取一段文本中所有 wiki 链接的区间与目标（纯空白目标视为无效跳过） */
export function wikiRanges(text: string): WikiRange[] {
  const out: WikiRange[] = [];
  for (const m of text.matchAll(WIKI_RE)) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({ from: m.index, to: m.index + m[0].length, target });
  }
  return out;
}

/** 光标前文本是否处于未闭合的 `[[查询` 状态；是则返回 { from(含`[[`), query } */
export function openWiki(textBefore: string): { from: number; query: string } | null {
  const m = /\[\[([^\[\]]*)$/.exec(textBefore);
  if (!m) return null;
  return { from: textBefore.length - m[0].length, query: m[1] };
}

/** 目标在章题列表中的候选（包含匹配、排除精确同名、去重），截断 limit 条 */
export function wikiCandidates(query: string, titles: string[], limit = 8): string[] {
  const q = query.trim();
  return [...new Set(titles)]
    .filter((t) => t !== q && (q === "" || t.includes(q)))
    .slice(0, limit);
}
