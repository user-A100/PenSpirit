import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

function editorWith(md: string) {
  return new Editor({
    extensions: [StarterKit, Markdown],
    content: md,
  });
}

describe("markdown 双向转换", () => {
  it("标题/段落/加粗经加载再导出保持不变", () => {
    const md = "# 第一章 初见\n\n黛玉走进来，看了宝玉一眼。\n\n**她心里想：这人似曾相识。**";
    const editor = editorWith(md);
    const out = editor.storage.markdown.getMarkdown();
    expect(out).toContain("# 第一章 初见");
    expect(out).toContain("黛玉走进来，看了宝玉一眼。");
    expect(out.replace(/\s+/g, "")).toContain("**她心里想：这人似曾相识。**".replace(/\s+/g, ""));
  });

  it("空内容往返为空", () => {
    const editor = editorWith("");
    expect(editor.storage.markdown.getMarkdown().trim()).toBe("");
  });
});
