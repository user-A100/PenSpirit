import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImportWizard } from "./ImportWizard";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: {
    previewImport: vi.fn(),
    previewImportDir: vi.fn(),
    checkDuplicates: vi.fn(),
    importChapters: vi.fn(),
    createBook: vi.fn(),
  },
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

/** 只取分章列表的复选框（排除「并入当前书」开关） */
function chapterBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox")
    .filter((c) => c.getAttribute("data-testid") !== "into-current") as HTMLInputElement[];
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
    expect(chapterBoxes().every((c) => c.checked)).toBe(true);
    expect(screen.getByText("导入 3 章")).toBeInTheDocument();
  });

  it("取消勾选后只导入被选中的章，并回调刷新", async () => {
    pickFile();
    (api.importChapters as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: 2, words: 20 });
    const onImported = vi.fn();
    render(<ImportWizard bookId={7} onClose={vi.fn()} onImported={onImported} />);

    fireEvent.click(screen.getByText("选择文件"));
    await screen.findByText("序章");

    // 并入当前书，聚焦验证「按勾选导入」本身
    fireEvent.click(screen.getByTestId("into-current"));
    fireEvent.click(chapterBoxes()[2]); // 取消「番外 后日谈」
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

  it("有选中书：默认仍按文件名建新书导入（防多书并一）；勾选并入当前书则不建书", async () => {
    pickFile();
    (api.createBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 9, title: "novel" });
    (api.importChapters as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: 3, words: 30 });
    const onImported = vi.fn();
    render(<ImportWizard bookId={7} onClose={vi.fn()} onImported={onImported} />);

    fireEvent.click(screen.getByText("选择文件"));
    await screen.findByText("序章");

    // 默认：新书
    fireEvent.click(screen.getByText("导入 3 章"));
    await waitFor(() => expect(api.createBook).toHaveBeenCalledWith("novel"));
    await waitFor(() => expect(api.importChapters).toHaveBeenCalledWith(9, PARSED));
    expect(onImported).toHaveBeenCalledWith(9);

    // 勾选并入当前书：不建书，直接导到 7
    (api.createBook as ReturnType<typeof vi.fn>).mockClear();
    (api.importChapters as ReturnType<typeof vi.fn>).mockClear();
    fireEvent.click(screen.getByText("选择文件"));
    await screen.findByText("序章");
    fireEvent.click(screen.getByTestId("into-current"));
    fireEvent.click(screen.getByText("导入 3 章"));
    await waitFor(() => expect(api.importChapters).toHaveBeenCalledWith(7, PARSED));
    expect(api.createBook).not.toHaveBeenCalled();
    expect(onImported).toHaveBeenCalledWith(7);
  });

  it("选文件夹：目录选择后走 previewImportDir 并全选", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("C:\\book");
    (api.previewImportDir as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "开端", content: "正文一", volume: null },
    ]);
    render(<ImportWizard bookId={null} onClose={vi.fn()} onImported={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /选文件夹/ }));

    expect(await screen.findByText("开端")).toBeInTheDocument();
    expect(api.previewImportDir).toHaveBeenCalledWith("C:\\book");
    expect(chapterBoxes().every((c) => c.checked)).toBe(true);
  });

  it("并入当前书时疑似重复章默认不勾选并标徽章", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\dup.txt");
    (api.previewImport as ReturnType<typeof vi.fn>).mockResolvedValue([
      { title: "旧章", content: "已有内容", volume: null },
      { title: "新章", content: "新内容", volume: null },
    ]);
    (api.checkDuplicates as ReturnType<typeof vi.fn>).mockResolvedValue([true, false]);
    render(<ImportWizard bookId={7} onClose={vi.fn()} onImported={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /选择文件/ }));

    expect(await screen.findByText("疑似重复")).toBeInTheDocument();
    const row = screen.getByText("旧章").closest("label")!;
    expect(row.querySelector("input")!.checked).toBe(false);
    expect(screen.getByText("导入 1 章")).toBeInTheDocument();
  });

  it("空库（bookId=null）：以文件名自动建书再导入，回传新书 id", async () => {
    pickFile();
    (api.createBook as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 9, title: "novel" });
    (api.importChapters as ReturnType<typeof vi.fn>).mockResolvedValue({ chapters: 3, words: 30 });
    const onImported = vi.fn();
    render(<ImportWizard bookId={null} onClose={vi.fn()} onImported={onImported} />);

    fireEvent.click(screen.getByText("选择文件"));
    await screen.findByText("序章");
    fireEvent.click(screen.getByText("导入 3 章"));

    // 文件名去扩展名作书名
    await waitFor(() => expect(api.createBook).toHaveBeenCalledWith("novel"));
    await waitFor(() =>
      expect(api.importChapters).toHaveBeenCalledWith(9, PARSED),
    );
    expect(onImported).toHaveBeenCalledWith(9);
  });
});
