import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
import { wikiRanges } from "../../lib/wiki";

// wiki 链接装饰（M7 批次3）：`[[章题]]` 在文档里就是纯文本，
// 用 Decoration 着色 + data-wiki 标记目标，点击跳转由 ChapterEditor 的
// handleDOMEvents 处理。刻意不用 mark——落盘 markdown 保持原样。

export const wikiKey = new PluginKey("wikiLinks");

function build(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    for (const r of wikiRanges(node.text)) {
      decos.push(
        Decoration.inline(pos + r.from, pos + r.to, {
          class: "wiki-link",
          "data-wiki": r.target,
        }),
      );
    }
  });
  return DecorationSet.create(doc, decos);
}

export const WikiLinks = Extension.create({
  name: "wikiLinks",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: wikiKey,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
        },
        props: {
          decorations(state) {
            return wikiKey.getState(state);
          },
        },
      }),
    ];
  },
});
