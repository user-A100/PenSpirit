import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { loadDocument } from "./editorDoc";

describe("loadDocument（切章载入不进撤销栈）", () => {
  it("载入后立刻输入再撤销：只撤回输入，正文不会被清空", () => {
    const ed = new Editor({ extensions: [StarterKit, Markdown], content: "" });
    loadDocument(ed, "旧城灯会。");
    expect(ed.can().undo()).toBe(false);
    ed.commands.insertContentAt(ed.state.doc.content.size - 1, "夜雨初歇。");
    expect(ed.state.doc.textContent).toBe("旧城灯会。夜雨初歇。");
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe("旧城灯会。");
    expect(ed.can().undo()).toBe(false);
    ed.destroy();
  });

  it("切到另一章后撤销栈清空：上一章的编辑不会被套到这一章", () => {
    const ed = new Editor({ extensions: [StarterKit, Markdown], content: "" });
    loadDocument(ed, "第一章。");
    ed.commands.insertContentAt(1, "改动");
    loadDocument(ed, "第二章正文。");
    expect(ed.can().undo()).toBe(false);
    ed.commands.undo();
    expect(ed.state.doc.textContent).toBe("第二章正文。");
    ed.destroy();
  });
});
