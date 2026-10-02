import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Editor as ReactEditor } from "@tiptap/react";

vi.mock("../../lib/tauri", () => ({
  api: {
    snapshotNow: vi.fn().mockResolvedValue(true),
    settingGet: vi.fn().mockResolvedValue(null),
    settingSet: vi.fn().mockResolvedValue(undefined),
    readChapter: vi.fn(),
    writeChapter: vi.fn(),
  },
}));
vi.mock("../../lib/ai/transient", () => ({
  runTransient: vi.fn((_task: unknown, onDelta?: (all: string) => void) => {
    onDelta?.("夜雨骤急");
    return { id: -1, cancel: vi.fn(), done: Promise.resolve("夜雨骤急，灯影乱晃。") };
  }),
}));

import { api, type ChatMessage } from "../../lib/tauri";
import { runTransient } from "../../lib/ai/transient";
import { AiTint, aiTintKey } from "./aiTint";
import { InlineAi } from "./InlineAi";
import { DiffReview } from "../chat/DiffReview";
import { reviewDiff } from "../../stores/review";
import { useInlineAi } from "../../stores/inlineAi";
import { useChat } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";
import { registerEditorBridge, type EditorBridge } from "../../lib/editorBridge";
import { adoptReply } from "../../lib/ai/adopt";
import { checkpointFor, restoreCheckpoint } from "../../lib/ai/checkpoint";

function fakeBridge(over: Partial<EditorBridge> = {}): EditorBridge {
  return {
    chapterId: 11,
    getContext: () => ({ chapterId: 11, before: "", after: "", selection: "", from: 1, to: 1 }),
    insertAtCursor: vi.fn(() => true),
    append: vi.fn(() => true),
    replaceRange: vi.fn(() => true),
    undo: vi.fn(),
    focus: vi.fn(),
    markdown: vi.fn(() => "采纳前的原文。"),
    setTint: vi.fn(),
    restoreContent: vi.fn(),
    insertAt: vi.fn(() => true),
    ...over,
  };
}

const decoCount = (ed: Editor, cls: string) =>
  (aiTintKey.getState(ed.state)?.set.find() ?? []).filter((d) => (d as unknown as { type: { attrs?: { class?: string } } }).type.attrs?.class === cls).length;

let unregister: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ activePane: "a" });
  useInlineAi.setState({ req: null });
});
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("AI 写入着色（阶段 2B）", () => {
  it("片段所在处打底；改一个字或关掉开关即消失", () => {
    const ed = new Editor({ extensions: [StarterKit, Markdown, AiTint], content: "<p>灯影摇晃，夜雨渐急。</p><p>我自己写的一段。</p>" });
    ed.view.dispatch(ed.state.tr.setMeta(aiTintKey, { snippets: ["灯影摇晃，夜雨渐急。"] }));
    expect(decoCount(ed, "ai-text")).toBe(1);
    ed.commands.insertContentAt(3, "了");
    expect(decoCount(ed, "ai-text")).toBe(0);
    ed.commands.undo();
    expect(decoCount(ed, "ai-text")).toBe(1);
    ed.view.dispatch(ed.state.tr.setMeta(aiTintKey, { on: false }));
    expect(decoCount(ed, "ai-text")).toBe(0);
    ed.destroy();
  });
});

describe("替换前逐段取舍（阶段 2B）", () => {
  it("两处改动只采用第一处：返回拼好的文本", async () => {
    render(<DiffReview />);
    let result: Promise<string | null> = Promise.resolve(null);
    act(() => {
      result = reviewDiff("替换选区 · 预览差异", "甲段原文很长的一个句子。\n乙段原文不变。\n丙段原文也是很长的句子。", "甲段新文很长的一个句子。\n乙段原文不变。\n丙段新文也是很长的句子。");
    });
    expect(document.querySelectorAll("[data-hunk]")).toHaveLength(2);
    fireEvent.click(screen.getAllByLabelText("这处保留原文")[1]);
    expect(document.querySelector('[data-hunk="1"]')).toHaveAttribute("data-accepted", "0");
    fireEvent.click(screen.getByText("应用 1/2 处"));
    await expect(result).resolves.toBe("甲段新文很长的一个句子。\n乙段原文不变。\n丙段原文也是很长的句子。");
  });
});

describe("采纳：只用选中部分 + 检查点（阶段 2B）", () => {
  it("插入选中部分；写入前先快照；之后可恢复到采纳之前", async () => {
    const bridge = fakeBridge();
    unregister = registerEditorBridge("a", bridge);
    const markAdopted = vi.fn(async () => {});
    useChat.setState({ chapterId: 11, clean: true, markAdopted });
    const msg: ChatMessage = { id: 902, session_id: 7, role: "assistant", content: "第一句。\n\n**选中的这一句。**\n\n第三句。", created_at: "", reply_to: 901, active: true };

    expect(await adoptReply(msg, "insert", null, "选中的这一句。")).toBe(true);
    expect(bridge.insertAtCursor).toHaveBeenCalledWith("选中的这一句。");
    expect(api.snapshotNow).toHaveBeenCalledWith(11, "采纳前的原文。");
    expect(vi.mocked(api.snapshotNow).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(bridge.insertAtCursor).mock.invocationCallOrder[0]);
    expect(markAdopted).toHaveBeenCalledWith(902, true);
    await waitFor(() => expect(api.settingSet).toHaveBeenCalledWith("ai_tint:11", JSON.stringify(["选中的这一句。"])));
    expect(bridge.setTint).toHaveBeenCalledWith(["选中的这一句。"]);

    expect(checkpointFor(902)).toBeDefined();
    vi.mocked(bridge.markdown!).mockReturnValue("采纳后又改过的正文。");
    expect(await restoreCheckpoint(902)).toBe(true);
    expect(api.snapshotNow).toHaveBeenLastCalledWith(11, "采纳后又改过的正文。");
    expect(bridge.restoreContent).toHaveBeenCalledWith("采纳前的原文。");
    expect(checkpointFor(902)).toBeUndefined();
  });
});

describe("就地 AI 浮条（阶段 2B）", () => {
  it("Alt+K 就地改写：无选区取当前段 → 输入要求 → 看差异 → 应用", async () => {
    const ed = new ReactEditor({ extensions: [StarterKit, Markdown, AiTint], content: "<p>夜雨渐急。</p><p>第二段。</p>" });
    ed.commands.setTextSelection(3);
    const bridge = fakeBridge();
    unregister = registerEditorBridge("a", bridge);
    useInlineAi.getState().open("edit", "a");
    render(<InlineAi editor={ed} chapterId={11} pane="a" />);
    expect(aiTintKey.getState(ed.state)?.pending).toEqual({ from: 1, to: 6 });

    const input = screen.getByLabelText("怎么改");
    fireEvent.change(input, { target: { value: "更紧张" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(runTransient).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "inline_edit", chapter_id: 11, selection: "夜雨渐急。", instruction: "更紧张", after: expect.stringContaining("第二段") }),
      expect.any(Function),
    );
    await waitFor(() => expect(document.querySelector("[data-inline-ai]")).toHaveAttribute("data-status", "done"));
    fireEvent.click(screen.getByText("应用"));
    await waitFor(() => expect(bridge.replaceRange).toHaveBeenCalledWith(1, 6, "夜雨渐急。", "夜雨骤急，灯影乱晃。"));
    expect(api.snapshotNow).toHaveBeenCalled();
    await waitFor(() => expect(useInlineAi.getState().req).toBeNull());
    expect(aiTintKey.getState(ed.state)?.pending).toBeNull();
    ed.destroy();
  });

  it("Alt+Enter 续写：打开即生成，应用插到光标处；Esc 丢弃", async () => {
    const ed = new ReactEditor({ extensions: [StarterKit, Markdown, AiTint], content: "<p>夜雨渐急。</p>" });
    ed.commands.setTextSelection(6);
    const bridge = fakeBridge();
    unregister = registerEditorBridge("a", bridge);
    useInlineAi.getState().open("continue", "a");
    const { unmount } = render(<InlineAi editor={ed} chapterId={11} pane="a" />);
    expect(runTransient).toHaveBeenCalledWith(expect.objectContaining({ kind: "continue", before: "夜雨渐急。", target_chars: 300 }), expect.any(Function));
    await waitFor(() => expect(document.querySelector("[data-inline-ai]")).toHaveAttribute("data-status", "done"));
    fireEvent.click(screen.getByText("应用"));
    await waitFor(() => expect(bridge.insertAt).toHaveBeenCalledWith(6, "夜雨骤急，灯影乱晃。"));
    unmount();

    useInlineAi.getState().open("continue", "a");
    render(<InlineAi editor={ed} chapterId={11} pane="a" />);
    fireEvent.keyDown(document.querySelector("[data-inline-ai]")!, { key: "Escape" });
    expect(useInlineAi.getState().req).toBeNull();
    ed.destroy();
  });
});
