import type { Editor } from "@tiptap/core";

// 正文落盘的 Markdown 出口（阶段 3A）。tiptap-markdown（prosemirror-markdown）序列化时会把 [ ] 转义成 \[ \]，
// 于是 [[章题]] 落盘变成 \[\[章题\]\]：Markdown 真源上不再是链接，后端反链扫描也认不出。
// [[…]] 是笔仙自己的链接语法（不是 Markdown 语法，重新载入时 markdown-it 按纯文本读回），故把成对转义还原；
// 单个方括号保持转义（避免与 Markdown 链接语法混淆），紧跟 "(" 的也不还原（否则重载会被解析成链接）。
const ESCAPED_WIKI = /\\\[\\\[((?:[^[\]\n\\]|\\[^[\]\n])+?)\\\]\\\](?!\()/g;

export function unescapeWikiLinks(md: string): string {
  return md.replace(ESCAPED_WIKI, "[[$1]]");
}

/** 编辑器内容 → 落盘 Markdown */
export function editorMarkdown(editor: Editor): string {
  return unescapeWikiLinks((editor.storage.markdown as { getMarkdown(): string }).getMarkdown());
}

/**
 * 在文档坐标 pos 处一分为二（阶段 3B 拆分章节）：返回前后两半的落盘 Markdown。
 * 段落中间拆开时两半各自成段；任一半没有文字返回 null（章首 / 章末无需拆分）。
 */
export function splitMarkdownAt(editor: Editor, pos: number): { head: string; tail: string } | null {
  const doc = editor.state.doc;
  const at = Math.max(0, Math.min(pos, doc.content.size));
  const head = doc.cut(0, at);
  const tail = doc.cut(at);
  if (head.textContent.trim() === "" || tail.textContent.trim() === "") return null;
  const ser = (editor.storage.markdown as { serializer: { serialize(node: unknown): string } }).serializer;
  return { head: unescapeWikiLinks(ser.serialize(head)).trim(), tail: unescapeWikiLinks(ser.serialize(tail)).trim() };
}
