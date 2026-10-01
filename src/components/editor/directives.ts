import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { directiveRanges } from "../../lib/ai/directives";

// 正文里的 [待写指令] / {作者批注} 着色（阶段 2C）：纯装饰，落盘的 Markdown 原样。
export const directivesKey = new PluginKey("aiDirectives");

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const r of directiveRanges(node.text)) {
      decos.push(
        Decoration.inline(pos + r.from, pos + r.to, {
          class: r.kind === "todo" ? "ai-directive-todo" : "ai-directive-note",
          "data-directive": r.kind,
          title: r.kind === "todo" ? "待写指令：光标放进来按 Alt+Enter，AI 按它写成正文" : "作者批注：只给 AI 看，不会写进正文",
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Directives = Extension.create({
  name: "aiDirectives",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: directivesKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return directivesKey.getState(state);
          },
        },
      }),
    ];
  },
});
