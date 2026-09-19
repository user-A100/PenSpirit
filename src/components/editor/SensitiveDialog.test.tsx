import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SensitiveDialog } from "./SensitiveDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

vi.mock("../../lib/tauri", () => ({
  api: {
    sensitiveGetWords: vi.fn(), sensitiveSetWords: vi.fn(),
    sensitiveScan: vi.fn(), sensitiveImportWords: vi.fn(),
  },
}));

import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../../lib/tauri";

const HITS = [
  { word: "暴力", byte_start: 3, context: "他举起手，暴力从指缝漏出" },
  { word: "血腥", byte_start: 20, context: "血腥味漫开" },
];

function dialog(content = "正文里有暴力与血腥。") {
  render(<SensitiveDialog content={content} onClose={vi.fn()} />);
}

describe("SensitiveDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.sensitiveGetWords as ReturnType<typeof vi.fn>).mockResolvedValue(["暴力", "血腥"]);
  });

  it("打开时载入词库到文本框", async () => {
    dialog();
    await waitFor(() =>
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("暴力\n血腥"),
    );
    expect(screen.getByText("词库 2 个词")).toBeInTheDocument();
  });

  it("检查本章列出命中与上下文", async () => {
    (api.sensitiveScan as ReturnType<typeof vi.fn>).mockResolvedValue(HITS);
    dialog();
    await screen.findByText("词库 2 个词");

    fireEvent.click(screen.getByText("检查本章"));

    await waitFor(() => expect(api.sensitiveScan).toHaveBeenCalledWith("正文里有暴力与血腥。"));
    expect(await screen.findByText("暴力")).toBeInTheDocument();
    expect(screen.getByText("血腥")).toBeInTheDocument();
    expect(screen.getByText("命中 2 处")).toBeInTheDocument();
    expect(screen.getByText("…他举起手，暴力从指缝漏出…")).toBeInTheDocument();
  });

  it("无命中时给出明确反馈", async () => {
    (api.sensitiveScan as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    dialog();
    await screen.findByText("词库 2 个词");

    fireEvent.click(screen.getByText("检查本章"));
    expect(await screen.findByText("未发现敏感词")).toBeInTheDocument();
  });

  it("词库为空时不能检查", async () => {
    (api.sensitiveGetWords as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    dialog();

    await screen.findByText("词库为空，先在下方添加词");
    expect(screen.getByText("检查本章").closest("button")).toBeDisabled();
  });

  it("改动词库后出现保存按钮，保存后回填清洗结果并作废旧结果", async () => {
    (api.sensitiveScan as ReturnType<typeof vi.fn>).mockResolvedValue(HITS);
    (api.sensitiveSetWords as ReturnType<typeof vi.fn>).mockResolvedValue(["暴力", "血腥", "色情"]);
    dialog();
    await screen.findByText("词库 2 个词");

    fireEvent.click(screen.getByText("检查本章"));
    await screen.findByText("暴力");

    expect(screen.queryByText("保存词库")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "暴力\n血腥\n色情\n" } });

    fireEvent.click(screen.getByText("保存词库"));
    await waitFor(() => expect(api.sensitiveSetWords).toHaveBeenCalledWith(["暴力", "血腥", "色情", ""]));
    expect(await screen.findByText("词库已保存（3 个词）")).toBeInTheDocument();
    // 词库变了，旧检查结果不再可信
    expect(screen.queryByText("命中 2 处")).not.toBeInTheDocument();
  });

  it("从 txt 导入并入文本框（仍需保存才生效）", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue("D:\\words.txt");
    (api.sensitiveImportWords as ReturnType<typeof vi.fn>).mockResolvedValue(["色情", "暴力"]);
    dialog();
    await screen.findByText("词库 2 个词");

    fireEvent.click(screen.getByText("从 txt 导入"));

    await waitFor(() => expect(api.sensitiveImportWords).toHaveBeenCalledWith("D:\\words.txt"));
    const box = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(box.value).toBe("暴力\n血腥\n色情"); // 与已有词合并去重
    expect(await screen.findByText(/从文件读入 2 个词/)).toBeInTheDocument();
    expect(api.sensitiveSetWords).not.toHaveBeenCalled();
  });

  it("取消文件选择时不动词库", async () => {
    (open as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    dialog();
    await screen.findByText("词库 2 个词");

    fireEvent.click(screen.getByText("从 txt 导入"));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(api.sensitiveImportWords).not.toHaveBeenCalled();
  });
});
