import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "./ImportWizard";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: { previewImport: vi.fn(), importChapters: vi.fn() },
}));

import { open } from "@tauri-apps/plugin-dialog";
import { api, type ParsedChapter } from "../../lib/tauri";

const PARSED: ParsedChapter[] = [
  { title: "序章", content: "那天夜里下着雪。", volume: "第一卷 风雪" },
  { title: "第一章 初见", content: "他推开门。", volume: "第一卷 风雪" },
  { title: "番外 后日谈", content: "很多年以后。", volume: null },
];

function pickFile() {
  (open as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\novel.txt");
  (api.previewImport as ReturnType<typeof vi.fn>).mockResolvedValue(PARSED);
}

describe("ImportWizard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("选文件后预览分章、按卷分组、默认全选", async () => {
    pickFile();
    render(<ImportWizard bookId={1} onClose={vi.fn()} onImported={vi.fn()} />);

    fireEvent.click(screen.getByText("选择文件"));

    expect(await screen.findByText("序章")).toBeInTheDocument();
    expect(api.previewImport).toHaveBeenCalledWith("D:\\novel.txt");
    expect(screen.getByText("第一章 初见")).toBeInTheDocument();
    expect(screen.getByText("第一卷 风雪")).toBeInTheDocument(); // 卷分组标题
    expect(screen.getByText("novel.txt")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").every((c) => (c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByText("导入 3 章")).toBeInTheDocument();
  });

  it("取消勾选后只导入被选中的章，并回调刷新", async () => {
    pickFile();
    (api.importChapters as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: 2, words: 20 });
    const onImported = vi.fn();
    render(<ImportWizard bookId={7} onClose={vi.fn()} onImported={onImported} />);

    fireEvent.click(screen.getByText("选择文件"));
    await screen.findByText("序章");

    fireEvent.click(screen.getAllByRole("checkbox")[2]); // 取消「番外 后日谈」
    fireEvent.click(screen.getByText("导入 2 章"));

    await waitFor(() =>
      expect(api.importChapters).toHaveBeenCalledWith(7, [PARSED[0], PARSED[1]]),
      { timeout: 2000 },
    );
    expect(onImported).toHaveBeenCalled();
    expect(await screen.findByText(/已导入 2 章/)).toBeInTheDocument();
  });

  it("解析报错时显示错误且不可导入", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\bad.docx");
    (api.previewImport as ReturnType<typeof vi.fn>).mockRejectedValue("docx 解析失败");
    render(<ImportWizard bookId={1} onClose={vi.fn()} onImported={vi.fn()} />);

    fireEvent.click(screen.getByText("选择文件"));

    expect(await screen.findByText(/docx 解析失败/)).toBeInTheDocument();
    expect(screen.getByText("导入 0 章")).toBeDisabled();
    expect(api.importChapters).not.toHaveBeenCalled();
  });

  it("用户取消文件选择时不做任何请求", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    render(<ImportWizard bookId={1} onClose={vi.fn()} onImported={vi.fn()} />);

    fireEvent.click(screen.getByText("选择文件"));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(api.previewImport).not.toHaveBeenCalled();
  });
});
