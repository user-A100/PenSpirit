// 拼音首字母与模糊匹配（命令面板跳章、阶段 2 斜杠命令共用）。
// 不引依赖：借 ICU 的中文拼音排序（Intl.Collator zh-u-co-pinyin），用各声母区间的
// 「最小字」做边界二分定位首字母。WebView2（Chromium 全量 ICU）与 Node（full-icu）均可用。

const BOUNDARIES = ["阿", "八", "嚓", "哒", "妸", "发", "旮", "哈", "讥", "咔", "垃", "痳", "拏", "噢", "妑", "七", "呥", "扨", "它", "穵", "夕", "丫", "帀"];
const LETTERS = "abcdefghjklmnopqrstwxyz";

let collator: Intl.Collator | null = null;
function getCollator(): Intl.Collator {
  if (!collator) collator = new Intl.Collator("zh-Hans-CN-u-co-pinyin", { sensitivity: "base" });
  return collator;
}

const cache = new Map<string, string>();

/** 单个汉字的拼音首字母（非汉字原样小写返回；无法判定返回空串） */
export function initialOf(ch: string): string {
  if (!/[㐀-鿿豈-﫿]/.test(ch)) return ch.toLowerCase();
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const c = getCollator();
  let letter = "";
  for (let i = BOUNDARIES.length - 1; i >= 0; i--) {
    if (c.compare(ch, BOUNDARIES[i]) >= 0) {
      letter = LETTERS[i];
      break;
    }
  }
  cache.set(ch, letter);
  return letter;
}

/** 字符串的拼音首字母串：「林晚」→ "lw"，「第2章」→ "d2z" */
export function initials(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/\s/.test(ch)) continue;
    out += initialOf(ch);
  }
  return out;
}

export interface MatchResult {
  score: number;
  /** 原文中命中的连续区间 [start, end)（仅子串命中时给出，用于高亮） */
  range?: [number, number];
}

/**
 * 模糊匹配打分（越大越好，null = 不匹配）：
 * 原文子串（前缀加分）> 拼音首字母子串 > 原文子序列。空查询给统一低分（保持原序）。
 */
export function fuzzyMatch(query: string, text: string): MatchResult | null {
  const q = query.trim().toLowerCase();
  if (q === "") return { score: 1 };
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx >= 0) {
    return { score: 100 - Math.min(idx, 20) - Math.min(t.length - q.length, 30) * 0.2 + (idx === 0 ? 10 : 0), range: [idx, idx + q.length] };
  }
  if (/^[a-z0-9]+$/.test(q)) {
    const ini = initials(text);
    const j = ini.indexOf(q);
    if (j >= 0) return { score: 70 - Math.min(j, 20) + (j === 0 ? 5 : 0) };
  }
  // 子序列：每个查询字符按序出现在原文中
  let pos = 0;
  let gaps = 0;
  for (const ch of q) {
    const k = t.indexOf(ch, pos);
    if (k < 0) return null;
    gaps += k - pos;
    pos = k + 1;
  }
  return { score: 40 - Math.min(gaps, 30) };
}
