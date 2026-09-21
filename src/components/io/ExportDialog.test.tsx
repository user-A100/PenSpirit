import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: { exportTxt: vi.fn(), exportDocx: vi.fn() },
}));

import { save } from "@tauri-apps/plugin-dialog";
import { api, type ChapterMeta } from "../../lib/tauri";

function ch(id: number, title: string, wordCount: number): ChapterMeta {
  return { id, book_id: 1, file_path: "", title, sort_key: id, word_count: wordCount, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null };
}

const CHAPTERS = [ch(11, "序章", 100), ch(12, "第一章 初见", 200)];

function dialog() {
  render(<ExportDialog bookId={1} bookTitle="书" chapters={CHAPTERS} onClose={vi.fn()} />);
}

describe("ExportDialog", () => {
  beforeEach(() => vi.clearAllMocks());

  it("默认全选并合计字数", () => {
    dialog();
    expect(screen.getByText("序章")).toBeInTheDocument();
    expect(screen.getByText("约 300 字")).toBeInTheDocument();
    expect(screen.getByText("全不选")).toBeInTheDocument();
  });

  it("txt 导出带上缩进开关与勾选的章", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\out.txt");
    dialog();

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(api.exportTxt).toHaveBeenCalledWith(1, [11, 12], true, "D:\\out.txt"));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: "书.txt" }),
    );
    expect(await screen.findByText(/已导出到/)).toBeInTheDocument();
  });

  it("关掉段首缩进后按 false 导出", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\out.txt");
    dialog();

    fireEvent.click(screen.getByText("段首缩进"));
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(api.exportTxt).toHaveBeenCalledWith(1, [11, 12], false, "D:\\out.txt"));
  });

  it("切到 DOCX 走 docx 导出（无缩进选项）", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\out.docx");
    dialog();

    fireEvent.click(screen.getByText("DOCX"));
    expect(screen.queryByText("段首缩进")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(api.exportDocx).toHaveBeenCalledWith(1, [11, 12], "D:\\out.docx"));
    expect(api.exportTxt).not.toHaveBeenCalled();
  });

  it("取消勾选后只导出被选中的章", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\out.txt");
    dialog();

    // 注意：列表上方还有「段首缩进」复选框，须按行定位章节复选框
    const row = screen.getByText("序章").closest("label")!;
    fireEvent.click(within(row).getByRole("checkbox"));
    expect(screen.getByText("约 200 字")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(api.exportTxt).toHaveBeenCalledWith(1, [12], true, "D:\\out.txt"));
  });

  it("保存对话框被取消时不导出", async () => {
    (save as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    dialog();

    fireEvent.click(screen.getByRole("button", { name: "导出" }));

    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(api.exportTxt).not.toHaveBeenCalled();
    expect(api.exportDocx).not.toHaveBeenCalled();
  });
});
