import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => {
  const fns: Record<string, unknown> = {};
  return {
    api: new Proxy(fns, {
      get: (t, k: string) => (t[k] ??= vi.fn().mockResolvedValue([])),
    }),
  };
});
vi.mock("../../lib/ai/transient", () => ({
  runTransient: vi.fn((task: { instruction: string }, onDelta?: (all: string) => void) => {
    onDelta?.("想");
    return { id: -1, cancel: vi.fn(), done: Promise.resolve(`答：${task.instruction}`) };
  }),
}));

import { api } from "../../lib/tauri";
import { runTransient } from "../../lib/ai/transient";
import { Composer } from "./Composer";
import { SideChat } from "./SideChat";
import { buildTurnOptions, useChat } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspace.setState({ currentBookId: 1, currentChapterId: 11, chapters: [] });
  useChat.setState({ sessionId: 7, chapterId: 11, streaming: false, mentions: [], disabledSlots: [], manualRules: [], attachments: [], quote: null, messages: [] });
});

describe("相关检索进 @ 菜单（阶段 2C）", () => {
  it("@ 后先列出相关章节 / 素材（相关度 + 摘录），选中带上相关段落", async () => {
    vi.mocked(api.relatedSearch).mockResolvedValue([
      { kind: "chapter", id: 5, title: "雪夜", score: 0.83, snippet: "沈砚在渡口救下林晚", passage: "那年冬天很冷。\n沈砚在渡口救下林晚。" },
      { kind: "material", id: 9, title: "渡口地形", score: 0.41, snippet: "渡口在旧城以北", passage: "渡口在旧城以北。" },
    ]);
    render(<Composer onLocal={() => {}} />);
    fireEvent.change(screen.getByLabelText("AI 指令"), { target: { value: "@" } });
    await waitFor(() => expect(document.querySelectorAll("[data-related]")).toHaveLength(2));
    expect(api.relatedSearch).toHaveBeenCalledWith(1, 11, expect.any(String), 5);
    expect(screen.getByText("相关 83%")).toBeInTheDocument();
    expect(screen.getByText("沈砚在渡口救下林晚")).toBeInTheDocument();
    expect(screen.getByText("雪夜（相关段落）")).toBeInTheDocument();
    fireEvent.mouseDown(document.querySelector("[data-related]")!);
    expect(useChat.getState().mentions[0]).toMatchObject({ kind: "chapter", id: 5, passage: "那年冬天很冷。\n沈砚在渡口救下林晚。" });
    expect(buildTurnOptions({}).mentions).toEqual([{ kind: "chapter", id: 5, passage: "那年冬天很冷。\n沈砚在渡口救下林晚。" }]);
  });
});

describe("侧聊（阶段 2C）", () => {
  it("并排问答：讨论模式、只带侧聊自己的历史；可清空、可关闭", async () => {
    const onClose = vi.fn();
    render(<SideChat onClose={onClose} />);
    const input = screen.getByLabelText("侧聊输入");
    fireEvent.change(input, { target: { value: "反派动机够吗？" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("答：反派动机够吗？");
    expect(runTransient).toHaveBeenCalledWith(expect.objectContaining({ kind: "discuss", chapter_id: 11, instruction: "反派动机够吗？", history: [] }), expect.any(Function));
    fireEvent.change(input, { target: { value: "那节奏呢？" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByText("答：那节奏呢？");
    expect(vi.mocked(runTransient).mock.calls[1][0]).toMatchObject({
      history: [
        { role: "user", content: "反派动机够吗？" },
        { role: "assistant", content: "答：反派动机够吗？" },
      ],
    });
    expect(document.querySelectorAll('[data-side-turn="user"]')).toHaveLength(2);
    fireEvent.click(screen.getByLabelText("清空侧聊"));
    expect(document.querySelectorAll("[data-side-turn]")).toHaveLength(0);
    fireEvent.click(screen.getByLabelText("关闭侧聊"));
    expect(onClose).toHaveBeenCalled();
    expect(useChat.getState().messages).toEqual([]);
  });
});
