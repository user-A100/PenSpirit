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
