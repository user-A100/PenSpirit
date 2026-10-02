// AI 输出采纳前的清洗（阶段 2A）：去掉开场白/客套结尾/Markdown 记号/段首空格，
// 统一段落——中文网文排版规范严格，用户不该手工擦「好的，以下是续写：」。

const OPENERS = /^(好的|好|当然|没问题|可以|收到|明白|以下是|下面是|这是|这里是|根据你的|按照你的|按你的|我将|我来|以下为)[^\n]{0,48}[:：]?$/;
const CLOSERS = /^(希望|如需|如果需要|需要我|如有|以上是|以上就是|有需要|若需要|如果你|你可以告诉我)/;

export function cleanAiText(raw: string, opts: { prose?: boolean } = {}): string {
  const prose = opts.prose ?? true;
  let t = raw.replace(/\r\n/g, "\n").trim();
  // 整段被代码块包裹
  const fenced = /^```[\w-]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fenced) t = fenced[1].trim();
  const lines = t.split("\n");
  // 开场白：只剥前两行内的典型句式（且后面还有正文）
  for (let k = 0; k < 2 && lines.length > 1; k++) {
    const first = lines[0].trim();
    if (first === "" || OPENERS.test(first)) lines.shift();
    else break;
  }
  // 客套结尾
  while (lines.length > 1) {
    const last = lines[lines.length - 1].trim();
    if (last === "" || last === "---" || CLOSERS.test(last)) lines.pop();
    else break;
  }
  t = lines.join("\n").trim();
  if (prose) {
    t = t
      .replace(/^#{1,6}\s+/gm, "") // 标题记号
      .replace(/\*\*([^*\n]+)\*\*/g, "$1") // 粗体
      .replace(/__([^_\n]+)__/g, "$1")
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2") // 斜体
      .replace(/^>\s?/gm, "") // 引用
      .replace(/^[ \t　]+/gm, "") // 段首空格（编辑器用 CSS 首行缩进）
      .replace(/\n{3,}/g, "\n\n");
    // 包裹整段的引号（模型偶尔把正文整体加引号）
    if (/^「[\s\S]*」$/.test(t) && !t.slice(1, -1).includes("「")) t = t.slice(1, -1);
  }
  return t.trim();
}

/** 复制用纯文本：去 Markdown 记号但保留段落 */
export function plainText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/^```[\w-]*\n?|```$/gm, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/^>\s?/gm, "")
    .trim();
}
