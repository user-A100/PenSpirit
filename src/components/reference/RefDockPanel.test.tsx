import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RefDockPanel } from "./RefDockPanel";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({ api: { readChapter: vi.fn(), openRefWindow: vi.fn() } }));

import { api, type ChapterMeta } from "../../lib/tauri";

const CHAPTERS: ChapterMeta[] = [
  { id: 11, book_id: 7, title: "一", sort_key: 1, file_path: "a.md" } as ChapterMeta,
  { id: 12, book_id: 7, title: "二", sort_key: 2, file_path: "b.md" } as ChapterMeta,
];

describe("RefDockPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.setState({ currentBookId: 7, chapters: CHAPTERS });
  });

  it("无书时提示先选一本书", () => {
    useWorkspace.setState({ currentBookId: null });
    render(<RefDockPanel />);
    expect(screen.getByText("先选一本书")).toBeInTheDocument();
  });

  it("选章后只读载入正文并显示字数", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: CHAPTERS[0], content: "风雪夜归人。" });
    render(<RefDockPanel />);

    fireEvent.change(screen.getByTestId("ref-chapter-select"), { target: { value: "11" } });
    await waitFor(() => expect(api.readChapter).toHaveBeenCalledWith(11));
    expect(await screen.findByText("风雪夜归人。")).toBeInTheDocument();
    expect(screen.getByText(/5 字/)).toBeInTheDocument();
  });

  it("空章给专属提示", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: CHAPTERS[1], content: "   " });
    render(<RefDockPanel />);
    fireEvent.change(screen.getByTestId("ref-chapter-select"), { target: { value: "12" } });
    expect(await screen.findByText("这一章还是空的。")).toBeInTheDocument();
  });

  it("弹出按钮：未选章禁用，选章后点击带书/章调 openRefWindow", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: CHAPTERS[0], content: "风雪夜归人。" });
    render(<RefDockPanel />);
    const popout = screen.getByTestId("ref-popout") as HTMLButtonElement;
    expect(popout.disabled).toBe(true);

    fireEvent.change(screen.getByTestId("ref-chapter-select"), { target: { value: "11" } });
    await waitFor(() => expect(popout.disabled).toBe(false));
    fireEvent.click(popout);
    await waitFor(() => expect(api.openRefWindow).toHaveBeenCalledWith(7, 11));
  });
});
