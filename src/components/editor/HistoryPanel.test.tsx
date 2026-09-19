import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryPanel } from "./HistoryPanel";

vi.mock("../../lib/tauri", () => ({
  api: {
    listHistory: vi.fn().mockResolvedValue([]),
    readHistory: vi.fn().mockResolvedValue(""),
    snapshotNow: vi.fn().mockResolvedValue(true),
  },
}));

import { api, type SnapshotInfo } from "../../lib/tauri";

const S1: SnapshotInfo = { file: "2026-09-19-10-00-00_4.md", ts: "2026-09-19 10:00:00", words: 4, title: "一" };
const S2: SnapshotInfo = { file: "2026-09-19-10-05-00_6.md", ts: "2026-09-19 10:05:00", words: 6, title: "一" };

function panel(over: Partial<Parameters<typeof HistoryPanel>[0]> = {}) {
  const props = {
    chapterId: 7,
    getCurrentContent: () => "第一行。\n第二行。",
    onRestore: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<HistoryPanel {...props} />);
  return props;
}

describe("HistoryPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("列出快照的时间与字数；无历史时显示空态", async () => {
    (api.listHistory as ReturnType<typeof vi.fn>).mockResolvedValue([S1, S2]);
    panel();
    expect(await screen.findByText("2026-09-19 10:00:00")).toBeInTheDocument();
    expect(screen.getByText("2026-09-19 10:05:00")).toBeInTheDocument();
    expect(screen.getByText("4 字")).toBeInTheDocument();
    expect(screen.getByText("6 字")).toBeInTheDocument();
    expect(screen.getByText("选择上方一个版本查看与当前正文的差异")).toBeInTheDocument();
  });

  it("空态提示", async () => {
    (api.listHistory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    panel();
    expect(await screen.findByText("还没有历史版本")).toBeInTheDocument();
  });

  it("选中快照后按行 diff：绿=恢复后新增，红=恢复后消失", async () => {
    (api.listHistory as ReturnType<typeof vi.fn>).mockResolvedValue([S1]);
    (api.readHistory as ReturnType<typeof vi.fn>).mockResolvedValue("第一行。\n第二行改。");
    panel();

    fireEvent.click(await screen.findByText("2026-09-19 10:00:00"));

    await waitFor(() => expect(api.readHistory).toHaveBeenCalledWith(7, S1.file));
    // 当前内容里的「第二行。」恢复后会消失；快照里的「第二行改。」会出现
    expect(await screen.findByText("第二行改。")).toBeInTheDocument();
    expect(screen.getByText("第二行。")).toBeInTheDocument();
    expect(screen.getByText("绿 = 恢复后新增的行，红 = 恢复后消失的行")).toBeInTheDocument();
    expect(screen.getByText("第一行。")).toBeInTheDocument();
  });

  it("恢复需二次确认，且先把编辑器实时内容补存为快照（往返安全）", async () => {
    (api.listHistory as ReturnType<typeof vi.fn>).mockResolvedValue([S1]);
    (api.readHistory as ReturnType<typeof vi.fn>).mockResolvedValue("旧版正文。");
    const props = panel({ getCurrentContent: () => "编辑器里尚未落盘的内容。" });

    fireEvent.click(await screen.findByTitle("恢复此版本"));
    expect(props.onRestore).not.toHaveBeenCalled();
    expect(api.snapshotNow).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle("确认恢复"));

    await waitFor(() =>
      expect(api.snapshotNow).toHaveBeenCalledWith(7, "编辑器里尚未落盘的内容。"),
      { timeout: 2000 },
    );
    await waitFor(() => expect(props.onRestore).toHaveBeenCalledWith("旧版正文。"));
    // 补存的当前版本会出现在刷新后的列表里
    await waitFor(() => expect(api.listHistory).toHaveBeenCalledTimes(2));
  });
});
