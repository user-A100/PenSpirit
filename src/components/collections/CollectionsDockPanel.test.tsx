import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CollectionsDockPanel } from "./CollectionsDockPanel";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: {
    collectionsList: vi.fn(),
    collectionUpsert: vi.fn(),
    collectionDelete: vi.fn(),
    collectionChapters: vi.fn(),
    collectionAddChapters: vi.fn(),
    collectionRemoveChapter: vi.fn(),
  },
}));

import { api, type ChapterMeta, type Collection } from "../../lib/tauri";

const COLS: Collection[] = [
  { id: 1, book_id: 7, name: "精选", kind: "manual", query: "", created_at: "t", updated_at: "t" },
  { id: 2, book_id: 7, name: "风雪", kind: "saved", query: "风雪", created_at: "t", updated_at: "t" },
];

const MEMBERS: ChapterMeta[] = [
  { id: 11, book_id: 7, title: "第一章", sort_key: 1, file_path: "a.md" } as ChapterMeta,
  { id: 12, book_id: 7, title: "第二章", sort_key: 2, file_path: "b.md" } as ChapterMeta,
];

describe("CollectionsDockPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.collectionsList as ReturnType<typeof vi.fn>).mockResolvedValue(COLS);
    (api.collectionChapters as ReturnType<typeof vi.fn>).mockResolvedValue(MEMBERS);
    useWorkspace.setState({
      currentBookId: 7,
      currentChapterId: 11,
      selectChapter: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("无书时提示先选一本书", async () => {
    useWorkspace.setState({ currentBookId: null });
    render(<CollectionsDockPanel />);
    expect(screen.getByText("先选一本书")).toBeInTheDocument();
    expect(api.collectionsList).not.toHaveBeenCalled();
  });

  it("分组渲染手动与搜索集合", async () => {
    render(<CollectionsDockPanel />);
    expect(await screen.findByText("手动集合（1）")).toBeInTheDocument();
    expect(screen.getByText("搜索集合（1）")).toBeInTheDocument();
    expect(screen.getByText("精选")).toBeInTheDocument();
    expect(screen.getByText("风雪")).toBeInTheDocument();
  });

  it("展开集合载入成员，点成员跳章", async () => {
    const selectChapter = useWorkspace.getState().selectChapter;
    render(<CollectionsDockPanel />);
    fireEvent.click(await screen.findByText("精选"));

    await screen.findByText("第一章");
    expect(api.collectionChapters).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTitle("跳到「第二章」"));
    expect(selectChapter).toHaveBeenCalledWith(12);
  });

  it("手动集合可添加当前章、移出成员；搜索集合没有这些按钮", async () => {
    (api.collectionAddChapters as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.collectionRemoveChapter as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<CollectionsDockPanel />);

    fireEvent.click(await screen.findByText("精选"));
    const addBtn = await screen.findByTitle("把当前章加入集合");
    fireEvent.click(addBtn);
    await waitFor(() => expect(api.collectionAddChapters).toHaveBeenCalledWith(1, [11]));
    await waitFor(() => expect(api.collectionChapters).toHaveBeenCalledTimes(2)); // 展开 + 添加后重取

    fireEvent.click(screen.getAllByTitle("移出集合")[0]);
    await waitFor(() => expect(api.collectionRemoveChapter).toHaveBeenCalledWith(1, 11));

    // 搜索集合：展开后（手风琴收起手动行）无添加/移出按钮
    fireEvent.click(screen.getByText("风雪"));
    await screen.findByText("第一章");
    expect(screen.queryByTitle("把当前章加入集合")).not.toBeInTheDocument();
    expect(screen.queryByTitle("移出集合")).not.toBeInTheDocument();
  });

  it("新建集合：输入名字回车，创建手动集合", async () => {
    (api.collectionUpsert as ReturnType<typeof vi.fn>).mockResolvedValue(COLS[0]);
    render(<CollectionsDockPanel />);

    fireEvent.click(await screen.findByTitle("新建手动集合"));
    const input = screen.getByTestId("collection-name-input");
    fireEvent.change(input, { target: { value: "待改" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.collectionUpsert).toHaveBeenCalledWith({
        id: null, book_id: 7, name: "待改", kind: "manual", query: "",
      }),
    );
  });

  it("删除集合需确认", async () => {
    const confirm = vi.fn(() => true);
    (window as unknown as { confirm: unknown }).confirm = confirm;
    (api.collectionDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<CollectionsDockPanel />);

    fireEvent.click(await screen.findByText("精选"));
    fireEvent.click(screen.getAllByTitle("删除集合")[0]);

    await waitFor(() => expect(api.collectionDelete).toHaveBeenCalledWith(1));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("精选"));
  });

  it("还没有集合时给引导文案", async () => {
    (api.collectionsList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<CollectionsDockPanel />);
    expect(await screen.findByText(/还没有集合/)).toBeInTheDocument();
  });
});
