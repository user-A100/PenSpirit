import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TrashPanel } from "./TrashPanel";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri_trash", () => ({
  trashApi: {
    listTrash: vi.fn().mockResolvedValue([]),
    restoreChapter: vi.fn().mockResolvedValue(undefined),
    purgeChapter: vi.fn().mockResolvedValue(undefined),
    emptyTrash: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/tauri", () => ({
  api: {
    listChapters: vi.fn().mockResolvedValue([]),
  },
}));

import { trashApi } from "../../lib/tauri_trash";

function trashed(id: number, title: string, origPath: string, deletedAt: string) {
  const slug = origPath.split("/")[0];
  const fileName = origPath.split("/").pop()!;
  return {
    id, book_id: 1, title, sort_key: 1, word_count: 0, created_at: "", updated_at: "",
    file_path: `${slug}/.trash/${fileName}`, deleted_at: deletedAt, orig_file_path: origPath,
  };
}

const ITEM = trashed(11, "初见", "书/manuscript/0001-初见.md", "2026-09-19 10:00:00");

describe("TrashPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.setState({ books: [], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
  });

  it("显示软删章的标题、删除时间与原路径；空态提示", async () => {
    (trashApi.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue([ITEM]);
    render(<TrashPanel bookId={1} onClose={() => {}} />);
    expect(await screen.findByText("初见")).toBeInTheDocument();
    expect(screen.getByText(/2026-09-19 10:00:00/)).toBeInTheDocument();
    expect(screen.getByText(/0001-初见\.md/)).toBeInTheDocument();
  });

  it("空回收站显示空态", async () => {
    (trashApi.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<TrashPanel bookId={1} onClose={() => {}} />);
    expect(await screen.findByText("回收站是空的")).toBeInTheDocument();
  });

  it("恢复调用命令并刷新章节列表与回收站", async () => {
    (trashApi.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue([ITEM]);
    render(<TrashPanel bookId={1} onClose={() => {}} />);
    fireEvent.click(await screen.findByTitle("恢复"));
    await waitFor(() => expect(trashApi.restoreChapter).toHaveBeenCalledWith(11));
    await waitFor(() => expect(trashApi.listTrash).toHaveBeenCalledTimes(2)); // 初次 + 恢复后刷新
  });

  it("彻底删除需二次确认", async () => {
    (trashApi.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue([ITEM]);
    render(<TrashPanel bookId={1} onClose={() => {}} />);
    const btn = await screen.findByTitle("彻底删除");
    fireEvent.click(btn);
    expect(trashApi.purgeChapter).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("确认彻底删除"));
    await waitFor(() => expect(trashApi.purgeChapter).toHaveBeenCalledWith(11));
  });

  it("清空回收站需二次确认", async () => {
    (trashApi.listTrash as ReturnType<typeof vi.fn>).mockResolvedValue([ITEM, trashed(12, "二章", "书/manuscript/0002-二章.md", "2026-09-19 10:01:00")]);
    render(<TrashPanel bookId={1} onClose={() => {}} />);
    const btn = await screen.findByTitle("清空回收站");
    fireEvent.click(btn);
    expect(trashApi.emptyTrash).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("确认清空"));
    await waitFor(() => expect(trashApi.emptyTrash).toHaveBeenCalledWith(1));
  });
});
