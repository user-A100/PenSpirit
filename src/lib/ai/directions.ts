// 「走向」回答解析（阶段 2B，Sudowrite Guided / 彩云小梦式）：拆出编号的几条走向，每条做成「按这条写」。
// 支持 1. / 1、/ 1）/ (1) / 一、/ 走向一： 等写法；条目内的续行并入该条；去掉 Markdown 粗体。
const HEAD = /^\s*(?:[-*]\s*)?(?:\*\*)?\s*(?:走向\s*)?\(?\s*(?:[0-9０-９]+|[一二三四五六七八九十]+)\s*(?:\*\*)?\s*(?:[.、．)）:：]|\s+)\s*(?:\*\*)?\s*(.+)$/;

export function parseDirections(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = HEAD.exec(line);
    if (m) out.push(m[1].replace(/\*\*/g, "").trim());
    else if (out.length > 0) out[out.length - 1] += line.replace(/\*\*/g, "");
  }
  return out.filter((x) => x.length > 0).slice(0, 6);
}
