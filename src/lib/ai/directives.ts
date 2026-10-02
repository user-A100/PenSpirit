// 正文里的 AI 指令（阶段 2C，与后端 context/directives.rs 同口径）：
// `[…]` 待写指令（光标放进去按 Alt+Enter，AI 按它写成正文替换掉）；`{…}` 只给 AI 看的批注。
// 只认半角括号、单行、内容 1–300 字；`[[章题]]` 是 wiki 链接，不算；`arr[0]` 这类紧跟英文 / 数字的、`[1]` 这类纯数字（脚注号）也不算。

export interface DirectiveRange {
  from: number;
  to: number;
  kind: "todo" | "note";
  inner: string;
}

const MAX = 300;

function closeOf(text: string, i: number, open: string, close: string): number {
  for (let j = i + 1; j < text.length && j - i - 1 <= MAX; j++) {
    const c = text[j];
    if (c === close) return j > i + 1 ? j : -1;
    if (c === "\n" || c === open) return -1;
  }
  return -1;
}

export function directiveRanges(text: string): DirectiveRange[] {
  const out: DirectiveRange[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      const j = closeOf(text, i, "{", "}");
      if (j > 0 && text.slice(i + 1, j).trim()) {
        out.push({ from: i, to: j + 1, kind: "note", inner: text.slice(i + 1, j).trim() });
        i = j + 1;
        continue;
      }
    } else if (c === "[") {
      if (text[i + 1] === "[") {
        const end = text.indexOf("]]", i + 2);
        if (end > 0) {
          i = end + 2;
          continue;
        }
      } else {
        const j = closeOf(text, i, "[", "]");
        const afterWord = i > 0 && /[A-Za-z0-9_]/.test(text[i - 1]);
        const footnote = /^[\d\s]*$/.test(text.slice(i + 1, j));
        if (j > 0 && text[j + 1] !== "]" && !afterWord && !footnote && text.slice(i + 1, j).trim()) {
          out.push({ from: i, to: j + 1, kind: "todo", inner: text.slice(i + 1, j).trim() });
          i = j + 1;
          continue;
        }
      }
    }
    i++;
  }
  return out;
}

/** 光标（offset）所在的指令：落在括号内或紧贴两端都算 */
export function directiveAt(text: string, offset: number, kind: DirectiveRange["kind"] = "todo"): DirectiveRange | null {
  return directiveRanges(text).find((r) => r.kind === kind && offset >= r.from && offset <= r.to) ?? null;
}
