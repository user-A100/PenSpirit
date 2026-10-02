import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageList } from "./MessageList";
import { MenuHost } from "../ui/MenuHost";
import { ConfirmHost } from "../ui/ConfirmHost";
import { useChat } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";
import { api, type ChapterMeta, type ChatMessage } from "../../lib/tauri";
import { parseExtraction } from "../../lib/ai/extract";

vi.mock("../../lib/tauri", () => ({
  api: {
    listMessages: vi.fn().mockResolvedValue([]),
    messageSetActive: vi.fn(),
    characterUpsert: vi.fn(),
    chapterUpdateMeta: vi.fn(),
  },
}));
vi.mock("../../lib/ai/transient", () => ({
  runTransient: vi.fn(() => ({
    id: -1,
    cancel: () => {},
    done: Promise.resolve('好的：\n```json\n[{"name":"林晚","role":"主角","aliases":"阿晚","description":"北境医女"},{"name":"","role":"x"}]\n```'),
  })),
}));

const u = (id: number, content: string): ChatMessage => ({ id, session_id: 7, role: "user", content, created_at: "" });
const a = (id: number, replyTo: number, content: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, session_id: 7, role: "assistant", content, created_at: "", reply_to: replyTo, active: true, meta: JSON.stringify({ mode: "discuss" }), ...extra,
});
const chapter = (synopsis: string) => ({ id: 11, book_id: 1, title: "一", synopsis, kind: "text" }) as unknown as ChapterMeta;

function renderList() {
  return render(
    <>
      <MessageList empty={null} />
      <MenuHost />
      <ConfirmHost />
    </>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useChat.setState({ sessionId: 7, chapterId: 11, streaming: false, streamText: "", streamReplyTo: null, pendingCandidates: null, commandByMessage: {}, quoteByMessage: {} });
  useWorkspace.setState({ currentBookId: 1, currentChapterId: 11, chapters: [chapter("")], volumes: [] });
});

describe("抽取解析", () => {
  it("去掉围栏取第一个数组；非 JSON 返回空", () => {
    expect(parseExtraction('```json\n[{"title":"玉佩","note":"第三章再现"}]\n```')).toEqual([{ title: "玉佩", note: "第三章再现" }]);
    expect(parseExtraction("没有可抽取的")).toEqual([]);
    expect(parseExtraction("[oops")).toEqual([]);
  });
});

describe("消息菜单 · 会话管理（阶段 2B）", () => {
  it("回答的「更多」：分叉 → forkSession(这条回答)；问题旁的分叉按钮 → forkSession(这一问)", async () => {
    const forkSession = vi.fn(async () => {});
    useChat.setState({ forkSession, messages: [u(1, "问"), a(2, 1, "答")] });
    renderList();
    fireEvent.click(screen.getByLabelText("更多"));
    fireEvent.click(await screen.findByText("从这里分叉为新对话"));
    await waitFor(() => expect(forkSession).toHaveBeenCalledWith(2));
    fireEvent.click(screen.getByLabelText("从这一问分叉"));
    expect(forkSession).toHaveBeenCalledWith(1);
  });

  it("收藏按钮切换 starred；已收藏显示「取消收藏」", () => {
    const starMessage = vi.fn(async () => {});
    useChat.setState({ starMessage, messages: [u(1, "问"), a(2, 1, "答", { starred: true })] });
    renderList();
    fireEvent.click(screen.getByLabelText("取消收藏"));
    expect(starMessage).toHaveBeenCalledWith(2, false);
  });

  it("抽取为人物卡：候选去掉空名，勾选后创建", async () => {
    vi.mocked(api.characterUpsert).mockResolvedValue({} as never);
    useChat.setState({ messages: [u(1, "问"), a(2, 1, "林晚是北境医女，别名阿晚。")] });
    renderList();
    fireEvent.click(screen.getByLabelText("更多"));
    fireEvent.click(await screen.findByText("抽取为…"));
    fireEvent.click(await screen.findByText("人物卡"));
    const dialog = await screen.findByTestId("extract-dialog");
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    fireEvent.click(screen.getByText("创建 1 张"));
    await waitFor(() =>
      expect(api.characterUpsert).toHaveBeenCalledWith({ id: null, book_id: 1, name: "林晚", role: "主角", aliases: "阿晚", description: "北境医女" }),
    );
  });

  it("存为本章梗概：已有梗概先确认再替换", async () => {
    useWorkspace.setState({ chapters: [chapter("旧梗概")] });
    vi.mocked(api.chapterUpdateMeta).mockResolvedValue(chapter("新梗概"));
    useChat.setState({ messages: [u(1, "问"), a(2, 1, "**新梗概**")] });
    renderList();
    fireEvent.click(screen.getByLabelText("更多"));
    fireEvent.click(await screen.findByText("存为本章梗概"));
    fireEvent.click(await screen.findByText("替换"));
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { synopsis: "新梗概" }));
    expect(useWorkspace.getState().chapters[0].synopsis).toBe("新梗概");
  });
});
