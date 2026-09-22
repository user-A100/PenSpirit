import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: { listChapters: vi.fn(), readChapter: vi.fn() },
}));

import { api } from "../../lib/tauri";
import { RefWindowApp } from "./RefWindowApp";

const CHAPTERS: ChapterMeta[] = [
  { id: 11, book_id: 7, title: "一", sort_key: 1, file_path: "a.md" } as ChapterMeta,
  { id: 12, book_id: 7, title: "二", sort_key: 2, file_path: "b.md" } as ChapterMeta,
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.listChapters as ReturnType<typeof vi.fn>).mockResolvedValue(CHAPTERS);
});

describe("RefWindowApp（M7 批次7 参考浮窗）", () => {
  it("带初值章打开：拉章节清单并自动载入该章正文", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: CHAPTERS[0], content: "风雪夜归人。" });
    render(<RefWindowApp bookId={7} initialChapterId={11} />);

    await waitFor(() => expect(api.listChapters).toHaveBeenCalledWith(7));
    expect(await screen.findByText("风雪夜归人。")).toBeInTheDocument();
    expect(screen.getByText(/5 字/)).toBeInTheDocument();
    expect((screen.getByTestId("ref-window-chapter-select") as HTMLSelectElement).value).toBe("11");
  });

  it("窗内切章即换正文；空章给提示", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockImplementation((id: number) =>
      Promise.resolve(
        id === 11
          ? { meta: CHAPTERS[0], content: "甲章正文" }
          : { meta: CHAPTERS[1], content: "  " },
      ),
    );
    render(<RefWindowApp bookId={7} initialChapterId={11} />);
    await screen.findByText("甲章正文");

    fireEvent.change(screen.getByTestId("ref-window-chapter-select"), { target: { value: "12" } });
    expect(await screen.findByText("这一章还是空的。")).toBeInTheDocument();
    expect(api.readChapter).toHaveBeenCalledWith(12);
  });

  it("无初值章时停在章选择空态", async () => {
    render(<RefWindowApp bookId={7} initialChapterId={null} />);
    await waitFor(() => expect(api.listChapters).toHaveBeenCalledWith(7));
    expect(screen.getByText("从上方选一章在此只读展示。")).toBeInTheDocument();
  });

  it("读章失败展示错误", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk gone"));
    render(<RefWindowApp bookId={7} initialChapterId={11} />);
    await waitFor(() => expect(screen.getByText(/disk gone/)).toBeInTheDocument());
  });

  it("挂载即设浮窗文档标题", () => {
    render(<RefWindowApp bookId={7} initialChapterId={null} />);
    expect(document.title).toBe("参考 · 笔仙");
  });
});
