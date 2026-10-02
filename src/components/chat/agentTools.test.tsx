import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import { PermissionCard } from "./PermissionCard";
import { useChat } from "../../stores/chat";
import type { ChatMessage } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: { listMessages: vi.fn().mockResolvedValue([]), messageSetActive: vi.fn() },
}));

const u: ChatMessage = { id: 1, session_id: 7, role: "user", content: "把第二章改紧凑些", created_at: "" };
const reply = (meta: object): ChatMessage => ({
  id: 2, session_id: 7, role: "assistant", content: "改好了。", created_at: "", reply_to: 1, active: true, meta: JSON.stringify({ backend: "agent", ...meta }),
});
const tools = [
  { id: "t1", title: "读取 第二章", kind: "read", status: "completed", paths: ["manuscript/0002-二.md"], added: 0, removed: 0 },
  { id: "t2", title: "改写 第二章", kind: "edit", status: "completed", paths: ["manuscript/0002-二.md"], added: 5, removed: 2 },
  { id: "t3", title: "运行脚本", kind: "execute", status: "failed", paths: [], added: 0, removed: 0 },
];

beforeEach(() => {
  useChat.setState({ sessionId: 7, streaming: false, streamText: "", streamReplyTo: null, pendingCandidates: null, commandByMessage: {}, quoteByMessage: {}, permission: null, permissionQueue: [] });
});

describe("agent 工具调用折叠 + 全部撤销（阶段 2B）", () => {
  it("默认收成一行，展开看每一步", () => {
    useChat.setState({ messages: [u, reply({ tools })] });
    render(<MessageList empty={null} />);
    expect(screen.getByText("调用了 3 个工具")).toBeInTheDocument();
    expect(screen.getByText("· 1 个失败")).toBeInTheDocument();
    expect(screen.queryByText("改写 第二章")).toBeNull();
    fireEvent.click(screen.getByLabelText("展开工具调用"));
    expect(screen.getByText("改写 第二章")).toBeInTheDocument();
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("+5")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-tool-status="failed"]')).toHaveLength(1);
  });

  it("文件改动清单 + 撤销全部改动；已撤销显示「恢复 AI 改动」", async () => {
    const undoAgentTurn = vi.fn(async () => {});
    const changes = [
      { path: "manuscript/0002-二.md", kind: "modified" },
      { path: "设定.md", kind: "added" },
    ];
    useChat.setState({ undoAgentTurn, messages: [u, reply({ tools, changes, undo: "1.json" })] });
    const { unmount } = render(<MessageList empty={null} />);
    expect(screen.getByText("AI 改动了 2 个文件")).toBeInTheDocument();
    fireEvent.click(screen.getByText("撤销全部改动"));
    await waitFor(() => expect(undoAgentTurn).toHaveBeenCalledWith(2));
    unmount();

    useChat.setState({ messages: [u, reply({ changes, undone: true, redo: "2.json" })] });
    render(<MessageList empty={null} />);
    expect(document.querySelector("[data-agent-changes]")).toHaveAttribute("data-undone", "1");
    expect(screen.getByText("恢复 AI 改动")).toBeInTheDocument();
  });

  it("没有撤销包的改动不给撤销按钮", () => {
    useChat.setState({ messages: [u, reply({ changes: [{ path: "a.md", kind: "added" }] })] });
    render(<MessageList empty={null} />);
    expect(screen.queryByText("撤销全部改动")).toBeNull();
  });
});

describe("权限卡（阶段 2B）", () => {
  it("显示类别与排队数；「本会话一直允许」带 always 应答", () => {
    const respondPermission = vi.fn(async () => {});
    const p = (id: string) => ({
      session_id: 7, request_id: id, title: "改写 第二章", tool_kind: "edit",
      options: [{ option_id: "ok", name: "允许", kind: "allow_once" }, { option_id: "no", name: "拒绝", kind: "reject_once" }],
    });
    useChat.setState({ respondPermission, permission: p("p1"), permissionQueue: [p("p2")] });
    render(<PermissionCard />);
    expect(screen.getByText("编辑")).toBeInTheDocument();
    expect(screen.getByText("还有 1 个")).toBeInTheDocument();
    fireEvent.click(screen.getByText("本会话一直允许「编辑」"));
    expect(respondPermission).toHaveBeenCalledWith("ok", { always: true });
  });
});
