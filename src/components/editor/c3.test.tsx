import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { Editor as ReactEditor } from "@tiptap/react";

vi.mock("../../lib/tauri", () => ({
  api: {
    aiTokenAlternatives: vi.fn(),
    settingGet: vi.fn().mockResolvedValue(null),
    settingSet: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock("../../lib/ai/transient", () => ({
  runTransient: vi.fn(() => ({ id: -1, cancel: vi.fn(), done: Promise.resolve('```json\n["刺骨", "凛冽", "寒"]\n```') })),
}));

import { api } from "../../lib/tauri";
import { runTransient } from "../../lib/ai/transient";
import { Ghost, ghostKey } from "./ghost";
import { WordSwap, parseWordList } from "./WordSwap";
import { useWordSwap } from "../../stores/wordSwap";
import { registerEditorBridge, type EditorBridge } from "../../lib/editorBridge";
import { useWorkspace } from "../../stores/workspace";
import { speak, stopSpeaking, useSpeech } from "../../lib/speech";
import { SpeechChip } from "../ui/SpeechChip";

let unregister: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ activePane: "a" });
  useWordSwap.setState({ req: null });
});
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("幽灵文本补全（阶段 2C）", () => {
  const key = (ed: Editor, k: string) => ed.view.someProp("handleKeyDown", (f) => f(ed.view, new KeyboardEvent("keydown", { key: k })));

  it("灰字只是装饰；Tab 接受（标为 AI 写入、不算手写），Esc / 继续打字即消失", () => {
    const onAccept = vi.fn();
    const ed = new Editor({ extensions: [StarterKit, Markdown, Ghost.configure({ onAccept })], content: "<p>雨很大。</p>" });
    const metas: unknown[] = [];
    ed.on("transaction", ({ transaction }) => metas.push(transaction.getMeta("aiInsert")));
    const end = ed.state.doc.content.size - 1;
    ed.view.dispatch(ed.state.tr.setMeta(ghostKey, { text: "他推门而出。", pos: end }));
    expect(ed.view.dom.querySelector("[data-ghost]")?.textContent).toBe("他推门而出。");
    expect(ed.state.doc.textContent).toBe("雨很大。");
    expect(key(ed, "Tab")).toBe(true);
    expect(ed.state.doc.textContent).toBe("雨很大。他推门而出。");
    expect(onAccept).toHaveBeenCalledWith("他推门而出。");
    expect(metas).toContain(true);
    expect(ghostKey.getState(ed.state)?.text).toBeNull();

    ed.view.dispatch(ed.state.tr.setMeta(ghostKey, { text: "再一句。", pos: ed.state.doc.content.size - 1 }));
    expect(key(ed, "Escape")).toBe(true);
    expect(ghostKey.getState(ed.state)?.text).toBeNull();
    ed.view.dispatch(ed.state.tr.setMeta(ghostKey, { text: "又一句。", pos: ed.state.doc.content.size - 1 }));
    ed.commands.insertContent("字");
    expect(ghostKey.getState(ed.state)?.text).toBeNull();
    expect(key(ed, "Tab")).toBeFalsy();
    ed.destroy();
  });
});

describe("换个说法（阶段 2C）", () => {
  it("解析词表：JSON 数组 / 围栏 / 退回按顿号切；去掉原词与编号", () => {
    expect(parseWordList('```json\n["刺骨", "凛冽"]\n```')).toEqual(["刺骨", "凛冽"]);
    expect(parseWordList("1. 刺骨、2. 凛冽、冷", "冷")).toEqual(["刺骨", "凛冽"]);
  });

  it("选中一个词：近义词 + 此处最可能的字（概率），点一个替换", async () => {
    vi.mocked(api.aiTokenAlternatives).mockResolvedValue({ supported: true, tokens: [{ token: "寒", prob: 0.62 }, { token: "冷", prob: 0.2 }] });
    const ed = new ReactEditor({ extensions: [StarterKit, Markdown], content: "<p>北风很冷，吹得人发抖。</p>" });
    ed.commands.setTextSelection({ from: 4, to: 5 });
    const bridge: EditorBridge = {
      chapterId: 11,
      getContext: () => ({ chapterId: 11, before: "", after: "", selection: "", from: 1, to: 1 }),
      insertAtCursor: vi.fn(() => true),
      append: vi.fn(() => true),
      replaceRange: vi.fn(() => true),
      undo: vi.fn(),
      focus: vi.fn(),
    };
    unregister = registerEditorBridge("a", bridge);
    act(() => useWordSwap.getState().open("a"));
    render(<WordSwap editor={ed} chapterId={11} pane="a" />);
    expect(runTransient).toHaveBeenCalledWith(expect.objectContaining({ kind: "synonyms", selection: "冷", text: "北风很冷，吹得人发抖。" }));
    expect(api.aiTokenAlternatives).toHaveBeenCalledWith(11, "北风很");
    await waitFor(() => expect(document.querySelector("[data-synonyms]")).toHaveAttribute("data-synonyms", "3"));
    await waitFor(() => expect(document.querySelector("[data-alternatives]")).toHaveAttribute("data-alternatives", "2"));
    expect(screen.getByText("62%")).toBeInTheDocument();
    fireEvent.click(screen.getByText("凛冽"));
    expect(bridge.replaceRange).toHaveBeenCalledWith(4, 5, "冷", "凛冽");
    expect(useWordSwap.getState().req).toBeNull();
    ed.destroy();
  });

  it("服务商不回概率：只给近义词并说明", async () => {
    vi.mocked(api.aiTokenAlternatives).mockResolvedValue({ supported: false, tokens: [] });
    const ed = new ReactEditor({ extensions: [StarterKit, Markdown], content: "<p>北风很冷。</p>" });
    ed.commands.setTextSelection({ from: 4, to: 5 });
    act(() => useWordSwap.getState().open("a"));
    render(<WordSwap editor={ed} chapterId={11} pane="a" />);
    expect(await screen.findByText("当前服务商不提供概率")).toBeInTheDocument();
    ed.destroy();
  });
});

describe("朗读（阶段 2C）", () => {
  it("按段逐段读、新的朗读打断旧的；浮动条可停止", () => {
    const spoken: string[] = [];
    const utterances: { text: string; onend?: () => void }[] = [];
    class U {
      text: string;
      lang = "";
      voice: unknown = null;
      onend?: () => void;
      onerror?: () => void;
      constructor(t: string) {
        this.text = t;
        utterances.push(this);
      }
    }
    const synth = { speak: vi.fn((u: U) => spoken.push(u.text)), cancel: vi.fn(), getVoices: () => [{ lang: "zh-CN", name: "Huihui" }] };
    vi.stubGlobal("SpeechSynthesisUtterance", U);
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    render(<SpeechChip />);
    act(() => {
      expect(speak("第一段。\n\n第二段。", "朗读回答")).toBe(true);
    });
    expect(spoken).toEqual(["第一段。"]);
    expect(screen.getByTestId("speech-chip")).toHaveTextContent("朗读回答");
    act(() => utterances[0].onend?.());
    expect(spoken).toEqual(["第一段。", "第二段。"]);
    act(() => utterances[1].onend?.());
    expect(useSpeech.getState().speaking).toBe(false);
    act(() => {
      speak("再读一段。");
    });
    fireEvent.click(screen.getByLabelText("停止朗读"));
    expect(synth.cancel).toHaveBeenCalled();
    expect(screen.queryByTestId("speech-chip")).toBeNull();
    stopSpeaking();
    vi.unstubAllGlobals();
  });
});
