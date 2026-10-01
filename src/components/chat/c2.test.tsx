import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Editor as ReactEditor } from "@tiptap/react";

vi.mock("../../lib/tauri", () => ({
  api: {
    listMessages: vi.fn().mockResolvedValue([]),
    messageSetActive: vi.fn(),
    snapshotNow: vi.fn().mockResolvedValue(true),
    settingGet: vi.fn().mockResolvedValue(null),
    settingSet: vi.fn().mockResolvedValue(undefined),
    attachmentRead: vi.fn(),
    phraseBiasList: vi.fn().mockResolvedValue([]),
    phraseBiasAdd: vi.fn().mockResolvedValue(true),
    phraseBiasDelete: vi.fn(),
    phraseBiasImportDefaults: vi.fn().mockResolvedValue(20),
    aiMemoryGet: vi.fn().mockResolvedValue({ book: "", volume_id: null, volume_title: null, volume: "", chapter_note: "" }),
    rulesList: vi.fn().mockResolvedValue([]),
  },
}));
vi.mock("../../lib/ai/transient", () => ({
  runTransient: vi.fn(() => ({ id: -1, cancel: vi.fn(), done: Promise.resolve("大雨里两人交手三招。") })),
}));

import { api, type ChatMessage } from "../../lib/tauri";
import { runTransient } from "../../lib/ai/transient";
import { directiveAt, directiveRanges } from "../../lib/ai/directives";
import { banHits, usePhraseBias } from "../../lib/ai/phraseBias";
import { useCtxPresets } from "../../lib/ai/ctxPresets";
import { buildTurnOptions, useChat } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";
import { useInlineAi } from "../../stores/inlineAi";
import { registerEditorBridge, type EditorBridge } from "../../lib/editorBridge";
import { AiTint, aiTintKey } from "../editor/aiTint";
import { Directives, directivesKey } from "../editor/directives";
import { InlineAi } from "../editor/InlineAi";
import { MessageList } from "./MessageList";
import { MemoryRules } from "./MemoryRules";

let unregister: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ activePane: "a", currentBookId: 1, currentChapterId: 11 });
  useChat.setState({ sessionId: 7, chapterId: 11, streaming: false, mentions: [], disabledSlots: [], manualRules: [], attachments: [], quote: null, commandByMessage: {}, quoteByMessage: {} });
  useCtxPresets.setState({ bookId: 1, list: [], active: null });
  usePhraseBias.setState({ bookId: 1, list: [] });
  useInlineAi.setState({ req: null });
});
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("正文里的 AI 指令（阶段 2C）", () => {
  it("[待写指令] 与 {批注}；wiki 链接、下标、脚注号不算", () => {
    const t = "林晚{她不知道}推门。[写一场打斗] 见[[第一章]]，arr[0]，注[3]。";
    expect(directiveRanges(t).map((r) => [r.kind, r.inner])).toEqual([
      ["note", "她不知道"],
      ["todo", "写一场打斗"],
    ]);
    const at = t.indexOf("[写") + 2;
    expect(directiveAt(t, at)?.inner).toBe("写一场打斗");
    expect(directiveAt(t, 1)).toBeNull();
  });

  it("编辑器里着色；光标在 [指令] 里按 Alt+Enter：按指令写、应用时替换整个方括号", async () => {
    const ed = new ReactEditor({ extensions: [StarterKit, Markdown, AiTint, Directives], content: "<p>雨很大。[写一场打斗]他走了。</p>" });
    const deco = (directivesKey.getState(ed.state) as { find: () => unknown[] }).find();
    expect(deco).toHaveLength(1);
    const text = "雨很大。[写一场打斗]他走了。";
    ed.commands.setTextSelection(1 + text.indexOf("打斗"));
    const bridge: EditorBridge = {
      chapterId: 11,
      getContext: () => ({ chapterId: 11, before: "", after: "", selection: "", from: 1, to: 1 }),
      insertAtCursor: vi.fn(() => true),
      append: vi.fn(() => true),
      replaceRange: vi.fn(() => true),
      undo: vi.fn(),
      focus: vi.fn(),
      markdown: () => text,
      setTint: vi.fn(),
    };
    unregister = registerEditorBridge("a", bridge);
    act(() => useInlineAi.getState().open("continue", "a"));
    render(<InlineAi editor={ed} chapterId={11} pane="a" />);
    const from = 1 + text.indexOf("[");
    const to = 1 + text.indexOf("]") + 1;
    expect(aiTintKey.getState(ed.state)?.pending).toEqual({ from, to });
    expect(runTransient).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "continue", before: "雨很大。", after: "他走了。", instruction: "按这条指令写一段正文：写一场打斗" }),
      expect.any(Function),
    );
    expect(document.querySelector("[data-inline-directive]")).toHaveAttribute("data-inline-directive", "写一场打斗");
    await waitFor(() => expect(document.querySelector("[data-inline-ai]")).toHaveAttribute("data-status", "done"));
    fireEvent.click(screen.getByText("应用"));
    await waitFor(() => expect(bridge.replaceRange).toHaveBeenCalledWith(from, to, "[写一场打斗]", "大雨里两人交手三招。"));
    ed.destroy();
  });
});

describe("上下文包（阶段 2C）", () => {
  it("常驻包与本轮临时设置合并进请求（去重）", () => {
    useChat.setState({ mentions: [{ kind: "character", id: 3, label: "林晚" }], disabledSlots: ["灵感卡"], manualRules: [5] });
    useCtxPresets.setState({
      active: { id: "c1", name: "战斗戏", mentions: [{ kind: "character", id: 3, label: "林晚" }, { kind: "plot", id: 9, label: "雨夜" }], disabledSlots: ["对话历史"], rules: [5, 6], mode: null, targetChars: null, temperature: null },
    });
    const o = buildTurnOptions({});
    expect(o.mentions).toEqual([{ kind: "character", id: 3 }, { kind: "plot", id: 9 }]);
    expect(o.disabled_slots).toEqual(["灵感卡", "对话历史"]);
    expect(o.rules).toEqual([5, 6]);
  });

  it("附件进本轮请求", () => {
    useChat.getState().addAttachment({ name: "参考.txt", text: "参考稿" });
    useChat.getState().addAttachment({ name: "参考.txt", text: "换了内容" });
    expect(buildTurnOptions({}).attachments).toEqual([{ name: "参考.txt", text: "换了内容" }]);
    useChat.getState().removeAttachment("参考.txt");
    expect(buildTurnOptions({}).attachments).toEqual([]);
  });
});

describe("AI 腔（阶段 2C）", () => {
  const ban = (id: number, phrase: string) => ({ id, book_id: null, phrase, kind: "ban" as const, created_at: "" });

  it("回答里出现禁用表达：提示几处，点「去掉重写」带要求重新生成", () => {
    const list = [ban(1, "嘴角勾起一抹弧度"), ban(2, "倒吸一口凉气"), { ...ban(3, "凛冽"), kind: "prefer" as const }];
    expect(banHits("他嘴角勾起一抹弧度，众人倒吸一口凉气。凛冽", list)).toEqual(["嘴角勾起一抹弧度", "倒吸一口凉气"]);
    usePhraseBias.setState({ list });
    const regenerate = vi.fn(async () => true);
    const u: ChatMessage = { id: 1, session_id: 7, role: "user", content: "写", created_at: "" };
    const a: ChatMessage = { id: 2, session_id: 7, role: "assistant", content: "他嘴角勾起一抹弧度。", created_at: "", reply_to: 1, active: true, meta: JSON.stringify({ mode: "write", attachments: ["参考.txt"] }) };
    useChat.setState({ regenerate, messages: [u, a] });
    render(<MessageList empty={null} />);
    expect(document.querySelector("[data-cliches]")).toHaveAttribute("data-cliches", "1");
    expect(document.querySelector("[data-attached]")?.textContent).toContain("参考.txt");
    fireEvent.click(screen.getByText("去掉重写"));
    expect(regenerate).toHaveBeenCalledWith(1, { retryHint: "不要用这些表达：嘴角勾起一抹弧度" });
  });

  it("记忆与规则里加词：按、分隔逐条加，可选所有书通用；一键导入常见 AI 腔", async () => {
    render(<MemoryRules />);
    await screen.findByTestId("phrase-bias");
    fireEvent.change(screen.getByLabelText("添加词语"), { target: { value: "冷笑、 眼底闪过一抹" } });
    fireEvent.click(screen.getByText("所有书通用"));
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() => expect(api.phraseBiasAdd).toHaveBeenCalledTimes(2));
    expect(api.phraseBiasAdd).toHaveBeenCalledWith(null, "冷笑", "ban");
    expect(api.phraseBiasAdd).toHaveBeenCalledWith(null, "眼底闪过一抹", "ban");
    fireEvent.click(screen.getByText("导入常见 AI 腔"));
    await waitFor(() => expect(api.phraseBiasImportDefaults).toHaveBeenCalledWith(null));
  });
});
