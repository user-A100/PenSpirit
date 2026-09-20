import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: { listBooks: vi.fn().mockResolvedValue([]), rescanLibrary: vi.fn().mockResolvedValue(0) },
}));

vi.mock("../../lib/tauri_trash", () => ({
  trashApi: {
    listTrash: vi.fn().mockResolvedValue([]),
    restoreChapter: vi.fn().mockResolvedValue(undefined),
    purgeChapter: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("Sidebar", () => {
  it("显示书籍与章节", () => {
    useWorkspace.setState({
      books: [{ id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "", target_words: null }],
      chapters: [{ id: 11, book_id: 1, file_path: "", title: "初见", sort_key: 1, word_count: 0, created_at: "", updated_at: "" }],
      currentBookId: 1,
    });
    render(<Sidebar />);
    expect(screen.getByText("红楼梦")).toBeInTheDocument();
    expect(screen.getByText("初见")).toBeInTheDocument();
  });

  it("回收站按钮开关 TrashPanel（M2-T6 入口接线）", async () => {
    useWorkspace.setState({ books: [], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
    render(<Sidebar />);
    expect(screen.queryByText("回收站是空的")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle("回收站"));
    expect(await screen.findByText("回收站是空的")).toBeInTheDocument();

    // 再次点击收起（按钮带 data-trash-toggle，面板的点击外部关闭不会抢跑）
    fireEvent.click(screen.getByTitle("回收站"));
    expect(screen.queryByText("回收站是空的")).not.toBeInTheDocument();
  });

  it("空库（无选中书）也显示导入入口，点击打开向导；导出入口仍隐藏", () => {
    useWorkspace.setState({
      books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null,
    });
    render(<Sidebar />);

    const importBtn = screen.getByTitle("导入章节");
    expect(importBtn).toBeInTheDocument();
    expect(screen.queryByTitle("导出全书")).not.toBeInTheDocument();

    fireEvent.click(importBtn);
    expect(screen.getByText("选择文件")).toBeInTheDocument();
  });
});
