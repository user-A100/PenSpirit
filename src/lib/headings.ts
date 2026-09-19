// M3-T7 悬浮大纲：从章节 markdown 抽两级大纲（level1 章 / level2 节）。
// 两类来源：markdown 标题（# 与 ##，行首缩进 ≤3 空格，### 及更深不算）
// 与中文章题行（第 + 1~7 位汉字/阿拉伯数字 + 章/回/节 + 至多 30 字余文，整行独立成题）。
// 同文本重复只保留首次出现（保序）；无命中回 []（浮窗显示「本章无小标题」）。

export interface Heading {
  level: 1 | 2;
  text: string;
}

/** markdown 标题：# 一级 / ## 二级；无空格、四格缩进（代码块）不算 */
const MD_HEADING = /^\s{0,3}(#{1,2})\s+(.+)$/;
/** 中文章题：如「第十二章 风雪夜」「第三回」「第9节」 */
const CN_CHAPTER = /^\s*(第[〇一二三四五六七八九十百千0-9]{1,7}[章回节][^\n]{0,30})$/;

export function parseHeadings(markdown: string): Heading[] {
  const seen = new Set<string>();
  const out: Heading[] = [];
  for (const line of markdown.split("\n")) {
    let h: Heading | null = null;
    const md = MD_HEADING.exec(line);
    if (md) h = { level: md[1] === "#" ? 1 : 2, text: md[2].trim() };
    else {
      const cn = CN_CHAPTER.exec(line);
      if (cn) h = { level: 1, text: cn[1].trim() };
    }
    if (!h || h.text === "" || seen.has(h.text)) continue;
    seen.add(h.text);
    out.push(h);
  }
  return out;
}
