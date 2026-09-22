import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Backlink, ChapterMeta, CharacterMention, WikiLink } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: {
    labelsList: vi.fn(),
    statusesList: vi.fn(),
    keywordsList: vi.fn(),
    keywordsForChapter: vi.fn(),
    templatesList: vi.fn(),
    readChapter: vi.fn(),
    linksScan: vi.fn(),
    chapterBacklinks: vi.fn(),
    characterMentions: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { LinksDockPanel } from "./LinksDockPanel";

function ch(p: Partial<ChapterMeta> & Pick<ChapterMeta, "id" | "title">): ChapterMeta {
  return {
    book_id: 1, file_path: "", sort_key: 1, word_count: 0,
    created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null,
    target_words: null, ...p,
  };
}

const LINKS: WikiLink[] = [
  { from_id: 11, from_title: "本章", target: "下章", to_id: 12, to_title: "下章", snippet: "…参见[[下章]]的伏笔…" },
  { from_id: 11, from_title: "本章", target: "幽灵章", to_id: null, to_title: null, snippet: "…他想起[[幽灵章]]…" },
];
const BACKLINKS: Backlink[] = [
  { from_id: 13, from_title: "前章", snippet: "…呼应[[本章]]的约定…" },
];
const MENTIONS: CharacterMention[] = [
  { character_id: 20, name: "张三", chapter_id: 11, chapter_title: "本章", count: 2 },
  { character_id: 20, name: "张三", chapter_id: 13, chapter_title: "前章", count: 1 },
  { character_id: 21, name: "李四", chapter_id: 11, chapter_title: "本章", count: 1 },
];

function resetStores() {
  useWorkspace.setState({
    books: [], chapters: [ch({ id: 11, title: "本章" }), ch({ id: 12, title: "下章", sort_key: 2 }), ch({ id: 13, title: "前章", sort_key: 3 })],
    currentBookId: 1, currentChapterId: 11, chapterContent: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 先备好 mock 再动 store：workspace.setState 会同步触发 meta 订阅拉取
  (api.labelsList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.statusesList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.keywordsList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.keywordsForChapter as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.templatesList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: ch({ id: 11, title: "本章" }), content: "" });
  (api.linksScan as ReturnType<typeof vi.fn>).mockResolvedValue(LINKS);
  (api.chapterBacklinks as ReturnType<typeof vi.fn>).mockResolvedValue(BACKLINKS);
  (api.characterMentions as ReturnType<typeof vi.fn>).mockResolvedValue(MENTIONS);
  resetStores();
});

describe("LinksDockPanel（M7 双链面板）", () => {
  it("渲染出链/反链/人物提及三区，出链带摘录", async () => {
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("出链（2）")).toBeInTheDocument());
    expect(screen.getByText("反向链接（1）")).toBeInTheDocument();
    expect(screen.getByText("前章")).toBeInTheDocument();
    expect(screen.getByText(/参见\[\[下章\]\]/)).toBeInTheDocument();
  });

  it("未解析目标灰显禁点；已解析点击跳章", async () => {
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("幽灵章")).toBeInTheDocument());

    const ghost = screen.getByText("幽灵章").closest("button")!;
    expect(ghost.disabled).toBe(true);

    fireEvent.click(screen.getByText("下章"));
    await waitFor(() => expect(useWorkspace.getState().currentChapterId).toBe(12));
  });

  it("反向链接点击跳来源章", async () => {
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("前章")).toBeInTheDocument());
    fireEvent.click(screen.getByText("前章"));
    await waitFor(() => expect(useWorkspace.getState().currentChapterId).toBe(13));
  });

  it("人物提及按人聚合：次数与章数，别名同权合并", async () => {
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("人物提及（2）")).toBeInTheDocument());
    expect(screen.getByText("张三")).toBeInTheDocument();
    expect(screen.getByText("3 次 · 2 章")).toBeInTheDocument();
    expect(screen.getByText("1 次 · 1 章")).toBeInTheDocument();
  });

  it("切章重扫：新章无出链/反链时空态", async () => {
    (api.linksScan as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.chapterBacklinks as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    useWorkspace.setState({ currentChapterId: 12 });
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("正文里还没有 [[章题]] 链接")).toBeInTheDocument());
    expect(screen.getByText("还没有别的章链到本章")).toBeInTheDocument();
    // 切到 12 章后出链按 from_id 过滤为空
    expect(api.linksScan).toHaveBeenCalledWith(1);
  });

  it("未选章时空态提示", () => {
    useWorkspace.setState({ currentChapterId: null });
    render(<LinksDockPanel />);
    expect(screen.getByText("先选一章")).toBeInTheDocument();
  });

  it("刷新按钮重新扫描", async () => {
    render(<LinksDockPanel />);
    await waitFor(() => expect(screen.getByText("出链（2）")).toBeInTheDocument());
    fireEvent.click(screen.getByTitle("重新扫描（保存后更新链接）"));
    await waitFor(() => expect(api.linksScan).toHaveBeenCalledTimes(2));
  });
});
