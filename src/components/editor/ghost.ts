import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

// 幽灵文本补全（阶段 2C，Copilot 式，默认关）：停顿后在光标处显示一小段灰字建议；
// Tab 接受、Esc 或继续打字 / 移动光标即消失。灰字只是装饰，接受前不进文档。
export interface GhostState {
  text: string | null;
  pos: number;
}

export const ghostKey = new PluginKey<GhostState>("aiGhost");
const EMPTY: GhostState = { text: null, pos: 0 };

export const Ghost = Extension.create<{ onAccept: (text: string) => void }>({
  name: "aiGhost",
  addOptions() {
    return { onAccept: () => {} };
  },
  addProseMirrorPlugins() {
    const onAccept = (t: string) => this.options.onAccept(t);
    return [
      new Plugin<GhostState>({
        key: ghostKey,
        state: {
          init: () => EMPTY,
          apply: (tr, old) => {
            const meta = tr.getMeta(ghostKey) as GhostState | undefined;
            if (meta) return meta;
            return tr.docChanged || tr.selectionSet ? EMPTY : old;
          },
        },
        props: {
          decorations(state) {
            const g = ghostKey.getState(state);
            if (!g?.text || g.pos > state.doc.content.size) return null;
            const text = g.text;
            return DecorationSet.create(state.doc, [
              Decoration.widget(
                g.pos,
                () => {
                  const el = document.createElement("span");
                  el.className = "ai-ghost";
                  el.setAttribute("data-ghost", "");
                  el.textContent = text;
                  return el;
                },
                { side: 1, key: `ghost:${text}` },
              ),
            ]);
          },
          handleKeyDown(view, e) {
            const g = ghostKey.getState(view.state);
            if (!g?.text) return false;
            if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
              const text = g.text;
              view.dispatch(view.state.tr.insertText(text, g.pos).setMeta(ghostKey, EMPTY).setMeta("aiInsert", true));
              onAccept(text);
              return true;
            }
            if (e.key === "Escape") {
              view.dispatch(view.state.tr.setMeta(ghostKey, EMPTY));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
