import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { editorMarkdown, unescapeWikiLinks } from "./markdownOut";

describe("unescapeWikiLinks", () => {
  it("成对转义的 [[章题]] 还原；单个方括号与紧跟 ( 的保持转义", () => {
    expect(unescapeWikiLinks("前文。\\[\\[雪落\\]\\]后文")).toBe("前文。[[雪落]]后文");
    expect(unescapeWikiLinks("\\[\\[甲\\]\\]、\\[\\[乙\\]\\]")).toBe("[[甲]]、[[乙]]");
    expect(unescapeWikiLinks("\\[\\[a\\_b\\]\\]")).toBe("[[a\\_b]]");
    expect(unescapeWikiLinks("\\[待补\\]")).toBe("\\[待补\\]");
    expect(unescapeWikiLinks("\\[\\[x\\]\\](http://a)")).toBe("\\[\\[x\\]\\](http://a)");
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
