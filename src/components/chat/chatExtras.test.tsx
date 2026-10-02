import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => ({
  api: { listMessages: vi.fn().mockResolvedValue([]), messageSetActive: vi.fn() },
}));

import type { ChatMessage } from "../../lib/tauri";
import { MessageList } from "./MessageList";
import { ChatFind, findRanges, useChatFind } from "./ChatFind";
import { useChat } from "../../stores/chat";
import { chatToMarkdown } from "../../lib/ai/exportChat";
import { fmtFull, fmtMsgTime, parseUtc } from "../../lib/time";

const u = (id: number, content: string, created_at = "2026-10-02 01:02:03"): ChatMessage => ({ id, session_id: 7, role: "user", content, created_at });
const a = (id: number, replyTo: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, session_id: 7, role: "assistant", content, created_at: "2026-10-02 01:02:09", reply_to: replyTo, active: true, meta: JSON.stringify({ mode: "write", command: "polish" }), ...extra,
});

beforeEach(() => {
  useChat.setState({ sessionId: 7, streaming: false, streamText: "", streamReplyTo: null, pendingCandidates: null, commandByMessage: {}, quoteByMessage: {}, permission: null, permissionQueue: [] });
  useChatFind.setState({ open: false });
});

describe("时间显示（阶段 2C）", () => {
  it("UTC 串按本地时间显示：今天只给时分，别的日子带月日，跨年带年", () => {
    const d = parseUtc("2026-10-02 01:02:03")!;
    expect(d.toISOString()).toBe("2026-10-02T01:02:03.000Z");
    expect(fmtMsgTime("2026-10-02 01:02:03", d)).toMatch(/^\d{2}:\d{2}$/);
    expect(fmtMsgTime("2026-10-02 01:02:03", new Date(d.getTime() + 3 * 86400_000))).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(fmtMsgTime("2026-10-02 01:02:03", new Date(d.getTime() + 400 * 86400_000))).toMatch(/^2026-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(fmtMsgTime("")).toBe("");
    expect(fmtFull("2026-10-02 01:02:03")).toMatch(/^2026-10-0\d \d{2}:\d{2}:03$/);
  });
});

describe("导出对话 Markdown（阶段 2C）", () => {
  it("只导出各问题当前选用的回答，标出模式 / 命令 / 采纳 / 评分；临时消息跳过", () => {
    const md = chatToMarkdown({
      bookTitle: "雪夜渡",
      chapterTitle: "第一章",
      sessionTitle: "润色讨论",
      messages: [u(1, "润色这段"), a(2, 1, "旧版本", { active: false }), a(3, 1, "新版本", { adopted: true, rating: 1 }), u(-5, "临时")],
      commandName: (id) => (id === "polish" ? "润色" : undefined),
      now: new Date("2026-10-02T03:00:00Z"),
    });
    expect(md.startsWith("# 润色讨论\n\n> 《雪夜渡》· 第一章 · 导出于 ")).toBe(true);
    expect(md).toContain("## 我 · ");
    expect(md).toContain("润色这段");
    expect(md).toContain("（写正文 · /润色 · 已采纳 · 👍）\n\n新版本");
    expect(md).not.toContain("旧版本");
    expect(md).not.toContain("临时");
  });
});

describe("消息上的时间与评分（阶段 2C）", () => {
  it("问题与回答都显示时间；👍 / 👎 再点一次取消", () => {
    const rateMessage = vi.fn(async () => {});
    useChat.setState({ rateMessage, messages: [u(1, "问"), a(2, 1, "答", { rating: 1 })] });
    render(<MessageList empty={null} />);
    expect(document.querySelectorAll("[data-msg-time]")).toHaveLength(2);
    expect(screen.getByLabelText("有用")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByLabelText("有用"));
    expect(rateMessage).toHaveBeenCalledWith(2, 0);
    fireEvent.click(screen.getByLabelText("没用"));
    expect(rateMessage).toHaveBeenCalledWith(2, -1);
  });
});

describe("会话内查找（阶段 2C）", () => {
  it("在消息里找全部命中（不区分大小写），回车下一个、计数随之变化，Esc 关闭", () => {
    useChat.setState({ messages: [u(1, "沈砚在哪？"), a(2, 1, "沈砚站在船头。SHEN 和 shen 都算。")] });
    render(
      <>
        <ChatFind />
        <MessageList empty={null} />
      </>,
    );
    const root = document.querySelector("[data-message-list]")!;
    expect(findRanges(root, "沈砚")).toHaveLength(2);
    expect(findRanges(root, "shen")).toHaveLength(2);
    act(() => useChatFind.getState().setOpen(true));
    const input = screen.getByLabelText("在对话中查找");
    fireEvent.change(input, { target: { value: "沈砚" } });
    expect(screen.getByTestId("chat-find")).toHaveAttribute("data-find-count", "2");
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "不存在" } });
    expect(screen.getByText("无结果")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useChatFind.getState().open).toBe(false);
  });
});
