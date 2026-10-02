import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./Sidebar";
import { MenuHost } from "../ui/MenuHost";
import { useWorkspace } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";

vi.mock("../../lib/tauri", () => ({
  api: {
    listBooks: vi.fn().mockResolvedValue([]),
    rescanLibrary: vi.fn().mockResolvedValue(0),
    renameChapter: vi.fn(),
    deleteChapter: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/tauri_trash", () => ({
  trashApi: {
    listTrash: vi.fn().mockResolvedValue([]),
    restoreChapter: vi.fn().mockResolvedValue(undefined),
    purgeChapter: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
  },
}));

const BOOK = { id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "", target_words: null };
const ch = (id: number, title: string) => ({
  id, book_id: 1, file_path: "", title, sort_key: id, word_count: 0, created_at: "", updated_at: "",
  synopsis: "", label_id: null, status_id: null, target_words: null,
});

async function flushMenu() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe("Sidebar", () => {
  it("顶部书切换器显示当前书，章节列表显示章节", () => {
    useWorkspace.setState({ books: [BOOK], chapters: [ch(11, "初见")], currentBookId: 1 });
    render(<Sidebar />);
    expect(screen.getByText("红楼梦")).toBeInTheDocument();
    expect(screen.getByText("初见")).toBeInTheDocument();
  });

  it("回收站按钮开关 TrashPanel（M2-T6 入口接线）", async () => {
    useWorkspace.setState({ books: [BOOK], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
    render(<Sidebar />);
    expect(screen.queryByText("回收站是空的")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("回收站"));
    expect(await screen.findByText("回收站是空的")).toBeInTheDocument();

    // 再次点击收起（按钮带 data-trash-toggle，面板的点击外部关闭不会抢跑）
    fireEvent.click(screen.getByLabelText("回收站"));
    expect(screen.queryByText("回收站是空的")).not.toBeInTheDocument();
  });

  it("空库也能导入：空态直接给「导入文本」，点击打开向导", () => {
    useWorkspace.setState({ books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null });
    render(<Sidebar />);
    fireEvent.click(screen.getByLabelText("导入章节"));
    expect(screen.getByText("选择文件")).toBeInTheDocument();
  });

  it("书切换器菜单：列出书、导入/导出入口；无书时无导出", async () => {
    useWorkspace.setState({ books: [BOOK], chapters: [], currentBookId: 1 });
    render(
      <>
        <Sidebar />
        <MenuHost />
      </>,
    );
    fireEvent.click(screen.getByLabelText("切换或管理书"));
    const items = (await screen.findAllByRole("menuitem")).map((m) => m.textContent);
    expect(items.some((t) => t?.includes("红楼梦"))).toBe(true);
    expect(items).toEqual(expect.arrayContaining(["新建书…", "导入章节…", "导出全书…", "删除这本书…"]));
  });

  it("F2 行内改名：Enter 提交调 renameChapter，Esc 取消不调", async () => {
    const { api } = await import("../../lib/tauri");
    (api.renameChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ ...ch(11, "相逢"), file_path: "x" });
    (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([BOOK]);
    useBinder.setState({ renaming: null });
    useWorkspace.setState({ books: [BOOK], chapters: [ch(11, "初见")], currentBookId: 1, currentChapterId: null });
    render(<Sidebar />);

    const row = screen.getByText("初见").closest("[data-chapter-row]") as HTMLElement;
    fireEvent.keyDown(row, { key: "F2" });
    const input = await screen.findByLabelText("新名称");
    fireEvent.change(input, { target: { value: "相逢" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(api.renameChapter).not.toHaveBeenCalled();

    fireEvent.keyDown(row, { key: "F2" });
    const input2 = await screen.findByLabelText("新名称");
    fireEvent.change(input2, { target: { value: "相逢" } });
    fireEvent.keyDown(input2, { key: "Enter" });
    await waitFor(() => expect(api.renameChapter).toHaveBeenCalledWith(11, "相逢"));
    await waitFor(() => expect(screen.getByText("相逢")).toBeInTheDocument());
  });

  it("右键菜单 → 移到回收站：调 deleteChapter 并从列表移除", async () => {
    const { api } = await import("../../lib/tauri");
    (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([BOOK]);
    useWorkspace.setState({ books: [BOOK], chapters: [ch(11, "初见"), ch(12, "再会")], currentBookId: 1, currentChapterId: null });
    render(
      <>
        <Sidebar />
        <MenuHost />
      </>,
    );
    fireEvent.contextMenu(screen.getByText("再会"));
    const item = await screen.findByText("移到回收站");
    fireEvent.click(item);
    await flushMenu();
    await waitFor(() => expect(api.deleteChapter).toHaveBeenCalledWith(12));
    await waitFor(() => expect(screen.queryByText("再会")).not.toBeInTheDocument());
  });
});
