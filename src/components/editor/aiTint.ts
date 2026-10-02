import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";

// AI 写入着色 + 就地改写的「待改区」高亮（阶段 2B）。两者都是装饰，不进文档、不落盘。
// 片段表与开关经 transaction meta 下发：tr.setMeta(aiTintKey, { snippets?, on?, pending? })。

export interface AiTintState {
  snippets: string[];
  on: boolean;
  /** 就地改写 / 续写进行中的区间（随编辑映射） */
  pending: { from: number; to: number } | null;
  set: DecorationSet;
}

export type AiTintMeta = Partial<Pick<AiTintState, "snippets" | "on" | "pending">>;

export const aiTintKey = new PluginKey<AiTintState>("aiTint");

function build(doc: PMNode, st: Omit<AiTintState, "set">): DecorationSet {
  const decos: Decoration[] = [];
  if (st.on && st.snippets.length > 0) {
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true;
      // 只处理纯文本段（含硬换行等原子节点时 textContent 偏移与文档位置对不上）
      let plain = true;
      node.forEach((c) => {
        if (!c.isText) plain = false;
      });
      if (!plain) return false;
      const text = node.textContent;
      for (const s of st.snippets) {
        let idx = text.indexOf(s);
        while (idx >= 0) {
          decos.push(Decoration.inline(pos + 1 + idx, pos + 1 + idx + s.length, { class: "ai-text" }));
          idx = text.indexOf(s, idx + s.length);
        }
      }
      return false;
    });
  }
  if (st.pending && st.pending.to <= doc.content.size) {
    const { from, to } = st.pending;
    if (to > from) decos.push(Decoration.inline(from, to, { class: "ai-pending" }));
    else decos.push(Decoration.widget(from, () => caret(), { side: 1, key: "ai-pending-caret" }));
  }
  return DecorationSet.create(doc, decos);
}

function caret(): HTMLElement {
  const el = document.createElement("span");
  el.className = "ai-pending-caret";
  el.setAttribute("aria-hidden", "true");
  return el;
}

export const AiTint = Extension.create({
  name: "aiTint",
  addProseMirrorPlugins() {
    return [
      new Plugin<AiTintState>({
        key: aiTintKey,
        state: {
          init: (_, state) => {
            const base = { snippets: [], on: true, pending: null };
            return { ...base, set: build(state.doc, base) };
          },
          apply: (tr, old) => {
            const meta = tr.getMeta(aiTintKey) as AiTintMeta | undefined;
            if (!meta && !tr.docChanged) return old;
            let pending = old.pending;
            if (pending && tr.docChanged) {
              const from = tr.mapping.map(pending.from, -1);
              const to = tr.mapping.map(pending.to, 1);
              pending = { from, to: Math.max(from, to) };
            }
            const next = {
              snippets: meta?.snippets ?? old.snippets,
              on: meta?.on ?? old.on,
              pending: meta && "pending" in meta ? meta.pending ?? null : pending,
            };
            return { ...next, set: build(tr.doc, next) };
          },
        },
        props: {
          decorations(state) {
            return aiTintKey.getState(state)?.set;
          },
        },
      }),
    ];
  },
});
