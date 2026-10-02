import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { editorMarkdown, splitMarkdownAt, unescapeWikiLinks } from "./markdownOut";

describe("unescapeWikiLinks", () => {
  it("成对转义的 [[章题]] 还原；单个方括号与紧跟 ( 的保持转义", () => {
    expect(unescapeWikiLinks("前文。\\[\\[雪落\\]\\]后文")).toBe("前文。[[雪落]]后文");
    expect(unescapeWikiLinks("\\[\\[甲\\]\\]、\\[\\[乙\\]\\]")).toBe("[[甲]]、[[乙]]");
    expect(unescapeWikiLinks("\\[\\[a\\_b\\]\\]")).toBe("[[a\\_b]]");
    expect(unescapeWikiLinks("\\[待补\\]")).toBe("\\[待补\\]");
    expect(unescapeWikiLinks("\\[\\[x\\]\\](http://a)")).toBe("\\[\\[x\\]\\](http://a)");
  });
});

describe("splitMarkdownAt（拆分章节）", () => {
  it("段落之间 / 段落中间拆开；章首章末返回 null；[[链接]] 不转义", () => {
    const ed = new Editor({ extensions: [StarterKit, Markdown], content: "第一段[[雪落]]。\n\n第二段前半第二段后半" });
    // 第二段开头（段落边界）
    const p2 = ed.state.doc.child(0).nodeSize;
    expect(splitMarkdownAt(ed, p2)).toEqual({ head: "第一段[[雪落]]。", tail: "第二段前半第二段后半" });
    // 第二段中间：「第二段前半」之后
    const mid = p2 + 1 + "第二段前半".length;
    expect(splitMarkdownAt(ed, mid)).toEqual({ head: "第一段[[雪落]]。\n\n第二段前半", tail: "第二段后半" });
    expect(splitMarkdownAt(ed, 0)).toBeNull();
    expect(splitMarkdownAt(ed, ed.state.doc.content.size)).toBeNull();
    ed.destroy();
  });
});

describe("editorMarkdown（真实 tiptap-markdown 往返）", () => {
  it("[[章题]] 载入 → 落盘保持原样；再载入仍是同一段文本", () => {
    const md = "前文。[[雪落]]后文\n\n第二段[[灯会]]。";
    const ed = new Editor({ extensions: [StarterKit, Markdown], content: md });
    const out = editorMarkdown(ed);
    expect(out).toBe(md);
    const ed2 = new Editor({ extensions: [StarterKit, Markdown], content: out });
    expect(ed2.state.doc.textContent).toBe(ed.state.doc.textContent);
    ed.destroy();
    ed2.destroy();
  });

  it("插入的链接文本同样不被转义", () => {
    const ed = new Editor({ extensions: [StarterKit, Markdown], content: "正文" });
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "[[尾声]]");
    expect(editorMarkdown(ed)).toBe("正文[[尾声]]");
    ed.destroy();
  });
});
