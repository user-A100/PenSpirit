// M3-T8 批量加词：把粘贴的一大串文字切成待入库词表。

/** 分隔符：空格 + 中西文逗号/顿号/分号/句号/叹问号/间隔号/竖线/斜杠 */
const SEPARATORS = /[\s,，、;；。．.!！?？·•|｜/\\]+/;

/** 单词上限：超过 16 字符的碎片视作误粘贴的句子，丢弃 */
const MAX_WORD_LEN = 16;

/**
 * 切分 → trim → 丢弃空串与超长（>16 字符）→ 去重保序。
 * 无分隔符的单词输入原样返回 ["词"]；空串/全分隔符回 []。
 */
export function parseWords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(SEPARATORS)) {
    const w = raw.trim();
    if (!w || w.length > MAX_WORD_LEN || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}
