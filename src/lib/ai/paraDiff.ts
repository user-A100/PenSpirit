// 段落级差异（阶段 2B）：替换前的预览按段切成「改动块」，用户逐块采用或保留原文。
// 对齐用 LCS，但「相似」的两段也算对上——AI 润色几乎每段都会改几个字，
// 只认严格相等会把整篇并成一个大块，逐段取舍就失去意义。

export type Segment =
  | { kind: "same"; text: string }
  | { kind: "change"; old: string[]; new: string[] };

/** 文本 → 段落（按行，去首尾空白与空行）——与编辑器桥 toParagraphs 同口径 */
export function splitParas(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

/** 两段的相似度（字二元组 Dice 系数，0–1） */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  let inter = 0;
  for (const [g, n] of bigrams(b)) {
    const m = A.get(g);
    if (m) inter += Math.min(m, n);
  }
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** 低于它的两段视为不同段（删一段、加一段），高于它视为同一段的改写 */
const SIMILAR = 0.3;

export function paragraphHunks(before: string, after: string): Segment[] {
  const a = splitParas(before);
  const b = splitParas(after);
  const n = a.length;
  const m = b.length;
  const sim: boolean[][] = a.map((x) => b.map((y) => similarity(x, y) >= SIMILAR));
  // dp[i][j] = a[i..] 与 b[j..] 的最长「相似」公共子序列
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = sim[i][j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);

  const out: Segment[] = [];
  let old: string[] = [];
  let neu: string[] = [];
  const flush = () => {
    if (old.length || neu.length) out.push({ kind: "change", old, new: neu });
    old = [];
    neu = [];
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (sim[i][j] && dp[i][j] === dp[i + 1][j + 1] + 1) {
      flush();
      out.push(a[i] === b[j] ? { kind: "same", text: a[i] } : { kind: "change", old: [a[i]], new: [b[j]] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) old.push(a[i++]);
    else neu.push(b[j++]);
  }
  while (i < n) old.push(a[i++]);
  while (j < m) neu.push(b[j++]);
  flush();
  return out;
}

/** 按每个改动块的取舍拼出最终文本（accept(k) = 第 k 个改动块用新文） */
export function applyHunks(segs: Segment[], accept: (k: number) => boolean): string {
  const out: string[] = [];
  let k = 0;
  for (const s of segs) {
    if (s.kind === "same") out.push(s.text);
    else out.push(...(accept(k++) ? s.new : s.old));
  }
  return out.join("\n");
}

/** 新文里「不是原文原样」的段落（AI 写入着色用） */
export function newParagraphs(before: string, after: string): string[] {
  const old = new Set(splitParas(before));
  return splitParas(after).filter((p) => !old.has(p));
}
