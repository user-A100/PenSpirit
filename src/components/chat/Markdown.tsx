import { Fragment, type ReactNode } from "react";

// 轻量 Markdown 渲染（阶段 2A 讨论模式）：标题 / 段落 / 列表 / 引用 / 代码块 / 分隔线 /
// 行内粗斜体与代码。直接产出 React 元素，不拼 HTML（无注入风险）、不引依赖。

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("`")) out.push(<code key={key} className="rounded-[4px] bg-[var(--fill-element)] px-1 py-px font-mono text-[0.9em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**") || tok.startsWith("__")) out.push(<strong key={key} className="font-semibold text-[color:var(--text-primary)]">{tok.slice(2, -2)}</strong>);
    else out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "ul" | "ol"; items: string[] }
  | { t: "quote"; text: string }
  | { t: "code"; text: string }
  | { t: "hr" };

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }
    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push({ t: "code", text: buf.join("\n") });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*+]\s+/, ""));
      blocks.push({ t: "ul", items });
      continue;
    }
    if (/^\s*\d+[.)、]\s*/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)、]\s*/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)、]\s*/, ""));
      blocks.push({ t: "ol", items });
      continue;
    }
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", text: buf.join("\n") });
      continue;
    }
    // 段落：连续非空、非块级起始行
    const buf: string[] = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== "" && !/^(```|#{1,6}\s|>\s?|\s*[-*+]\s+|\s*\d+[.)、]\s*)/.test(lines[i])) buf.push(lines[i++]);
    blocks.push({ t: "p", text: buf.join("\n") });
  }
  return blocks;
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="flex flex-col gap-2 text-sm leading-relaxed text-[color:var(--text-primary)]">
      {blocks.map((b, i) => {
        const k = `b${i}`;
        switch (b.t) {
          case "h":
            return (
              <div key={k} className={`font-semibold ${b.level <= 2 ? "mt-1 text-md" : "text-sm"}`}>
                {inline(b.text, k)}
              </div>
            );
          case "ul":
          case "ol": {
            const Tag = b.t === "ul" ? "ul" : "ol";
            return (
              <Tag key={k} className={`flex flex-col gap-1 pl-5 ${b.t === "ul" ? "list-disc" : "list-decimal"} marker:text-[color:var(--text-faint)]`}>
                {b.items.map((it, j) => (
                  <li key={j}>{inline(it, `${k}-${j}`)}</li>
                ))}
              </Tag>
            );
          }
          case "quote":
            return (
              <blockquote key={k} className="border-l-2 border-[color:var(--hairline)] pl-3 text-[color:var(--text-secondary)]">
                {b.text.split("\n").map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}-${j}`)}
                  </Fragment>
                ))}
              </blockquote>
            );
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-[var(--r-control)] bg-[var(--fill-element)] px-3 py-2 font-mono text-xs leading-relaxed">
                {b.text}
              </pre>
            );
          case "hr":
            return <hr key={k} className="border-0 border-t border-[color:var(--hairline)]" />;
          default:
            return (
              <p key={k} className="whitespace-pre-wrap">
                {b.text.split("\n").map((l, j) => (
                  <Fragment key={j}>
                    {j > 0 && <br />}
                    {inline(l, `${k}-${j}`)}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
