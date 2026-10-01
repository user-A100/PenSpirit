import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import { MenuHost } from "../ui/MenuHost";
import { useChat } from "../../stores/chat";
import type { ChatMessage } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    listMessages: vi.fn().mockResolvedValue([]),
    messageSetActive: vi.fn(),
  },
}));

const u = (id: number, content: string): ChatMessage => ({ id, session_id: 7, role: "user", content, created_at: "" });
const a = (id: number, replyTo: number, content: string, meta: object, active = false): ChatMessage => ({
  id, session_id: 7, role: "assistant", content, created_at: "", reply_to: replyTo, active, meta: JSON.stringify(meta),
});

beforeEach(() => {
  useChat.setState({ sessionId: 7, streaming: false, streamText: "", streamReplyTo: null, pendingCandidates: null, commandByMessage: {}, quoteByMessage: {} });
});

describe("消息流 · 生成控制（阶段 2B）", () => {
  it("多候选并排：每版一张卡，当前版高亮，「用这版」切换", async () => {
    const switchVariant = vi.fn(async () => {});
    useChat.setState({
      switchVariant,
      messages: [
        u(1, "写一段雪夜"),
        a(2, 1, "第一版正文。", { mode: "write", candidates: 3 }, true),
        a(3, 1, "第二版正文。", { mode: "write", candidates: 3 }),
        a(4, 1, "第三版正文。", { mode: "write", candidates: 3, retry: "这次写得更短" }),
      ],
    });
    render(<MessageList empty={null} />);
    expect(document.querySelector("[data-candidates]")).toHaveAttribute("data-candidates", "3");
    expect(screen.getByText("第二版正文。")).toBeInTheDocument();
    expect(screen.getByText("· 这次写得更短")).toBeInTheDocument();
    expect(screen.getAllByText("用这版")).toHaveLength(2);
    fireEvent.click(screen.getAllByText("用这版")[0]);
    expect(switchVariant).toHaveBeenCalledWith(3);
  });

  it("「走向」回答拆成可点的几条，点「按这条写」发写正文请求", () => {
    const send = vi.fn(async () => true);
    useChat.setState({
      send,
      messages: [u(1, "接下来怎么写？"), a(2, 1, "1. 雪夜追兵\n2. 林晚负伤\n3. 旧城失火", { mode: "discuss", command: "directions" }, true)],
    });
    render(<MessageList empty={null} />);
    expect(document.querySelector("[data-directions]")).toHaveAttribute("data-directions", "3");
    fireEvent.click(screen.getAllByText("按这条写")[1]);
    expect(send).toHaveBeenCalledWith("按这条走向往下写：林晚负伤", { command: "continue", mode: "write", targetChars: 800 });
  });

  it("重试选项菜单：选「更短」带上提示重新生成；压缩摘要有标记；字数旁有 token", async () => {
    const regenerate = vi.fn(async () => true);
    useChat.setState({
      regenerate,
      messages: [u(1, "请压缩"), a(2, 1, "摘要：主角在北境。", { mode: "discuss", command: "compact" }, true)],
    });
    render(
      <>
        <MessageList empty={null} />
        <MenuHost />
      </>,
    );
    expect(document.querySelector("[data-compact-summary]")).toBeInTheDocument();
    expect(screen.getByText(/字 · ~\d+ tokens/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("带要求重新生成"));
    fireEvent.click(await screen.findByText("更短"));
    await waitFor(() => expect(regenerate).toHaveBeenCalledWith(1, { retryHint: expect.stringContaining("更短") }));
  });
});
