import type { Editor } from "@tiptap/core";
import { EditorState } from "@tiptap/pm/state";

/**
 * 换上一份新正文并清空撤销栈（切章载入 / 拆分合并后的程序化替换）。
 * 载入不是一次「编辑」：若它留在撤销栈里，打开章节后 0.5 秒内的输入（或 AI 采纳）会与它合并成同一步，
 * Ctrl+Z 一下就回到载入之前——正文变空，随后被自动保存落盘；切章后的撤销也会把上一章的步骤套到这一章上。
 */
export function loadDocument(editor: Editor, content: string): void {
  editor.chain().setMeta("addToHistory", false).setContent(content).run();
  const { state, view } = editor;
  view.updateState(EditorState.create({ doc: state.doc, plugins: state.plugins, selection: state.selection }));
}
