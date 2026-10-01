import type { PaneId } from "../stores/workspace";
import { useWorkspace } from "../stores/workspace";

// 编辑器桥（阶段 2A）：AI 对话需要读光标/选区、把结果插入或替换进正文。
// 每个窗格的 ChapterEditor 挂载时注册自己的实现；对话侧只认「活动窗格」。

export interface EditorContext {
  chapterId: number;
  /** 光标（或选区起点）之前的正文 */
  before: string;
  /** 光标（或选区终点）之后的正文 */
  after: string;
  /** 选中文本（无选区为空串） */
  selection: string;
  from: number;
  to: number;
}

export interface EditorBridge {
  chapterId: number;
  getContext(): EditorContext;
  /** 在光标处插入（多段文本按行拆成段落）；返回是否成功 */
  insertAtCursor(text: string): boolean;
  /** 追加到章末 */
  append(text: string): boolean;
  /** 把 [from,to) 替换为 text；该区间当前文本须等于 expected（防止期间改动后错位），否则在全文里找 expected */
  replaceRange(from: number, to: number, expected: string, text: string): boolean;
  undo(): void;
  focus(): void;
  /** 在屏幕坐标处插入行内文本（侧栏把章拖进正文 → [[章题]]）；坐标不在正文里返回 false */
  insertAtPoint?(x: number, y: number, text: string): boolean;
}

const bridges = new Map<PaneId, EditorBridge>();

export function registerEditorBridge(pane: PaneId, bridge: EditorBridge): () => void {
  bridges.set(pane, bridge);
  return () => {
    if (bridges.get(pane) === bridge) bridges.delete(pane);
  };
}

/** 活动窗格的编辑器（未打开章节时为 null） */
export function getActiveEditor(): EditorBridge | null {
  return bridges.get(useWorkspace.getState().activePane) ?? null;
}

/** 指定窗格的编辑器（拖放落点所在窗格） */
export function getEditorFor(pane: PaneId): EditorBridge | null {
  return bridges.get(pane) ?? null;
}

/** 文本 → 段落列表：按换行拆分，去空行（中文网文一行即一段） */
export function toParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
