import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssemblyLog, ContextConfig, PlotBlock } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: {
    contextConfigGet: vi.fn(),
    contextConfigSet: vi.fn(),
    plotBlocksList: vi.fn(),
    ideasList: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { ContextPreview } from "./ContextPreview";

const DEFAULT_CFG: ContextConfig = {
  characters: { enabled: true, budget: 1500, ids: null, all: false },
  foreshadows: { enabled: true, budget: 800, ids: null, all: false },
  plots: { enabled: false, budget: 1000, ids: null, all: false },
  ideas: { enabled: false, budget: 600, ids: null, all: false },
};

const LOG: AssemblyLog = {
  slots: [
    { name: "System", source: "基础提示", chars: 50, est_tokens: 80, preview_head: "你是长篇小说的合著者" },
    { name: "角色卡", source: "关键词命中 1 人", chars: 20, est_tokens: 32, preview_head: "- 林远山（主角）：沉默寡言。" },
  ],
  total_est_tokens: 112,
};

function pb(p: Partial<PlotBlock> & Pick<PlotBlock, "id" | "content">): PlotBlock {
  return { book_id: 1, status: "idea", chapter_id: null, sort_key: 0, created_at: "2026-09-01 00:00:00", ...p };
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.contextConfigGet as ReturnType<typeof vi.fn>).mockResolvedValue(DEFAULT_CFG);
  (api.contextConfigSet as ReturnType<typeof vi.fn>).mockImplementation(async (_bookId: number, c: ContextConfig) => c);
  (api.plotBlocksList as ReturnType<typeof vi.fn>).mockResolvedValue([
    pb({ id: 201, content: "雪夜追杀" }),
    pb({ id: 202, content: "渡口重逢" }),
  ]);
  (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 301, content: "雨声中的密信", words_json: "[]", tags_json: "[]", created_at: "" },
  ]);
  useWorkspace.setState({ books: [], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
});

async function openSettings(onConfigChanged?: () => void) {
  render(<ContextPreview log={LOG} loading={false} onConfigChanged={onConfigChanged} />);
  fireEvent.click(screen.getByTitle("注入设置"));
  await screen.findByTestId("inj-toggle-characters");
}

describe("ContextPreview", () => {
  it("空态与槽位渲染：null 时提示刷新，有 log 时列出槽位明细", () => {
    const { rerender } = render(<ContextPreview log={null} loading={false} />);
    expect(screen.getByText("点击刷新查看本次续写的上下文组装")).toBeInTheDocument();

    rerender(<ContextPreview log={LOG} loading={false} />);
    expect(screen.getByText("共 2 个槽位 · 估算 112 tokens")).toBeInTheDocument();
    expect(screen.getByText("角色卡")).toBeInTheDocument();
    expect(screen.getByText("关键词命中 1 人")).toBeInTheDocument();
    expect(screen.getByText("20 字 / ~32 tokens")).toBeInTheDocument();
    expect(screen.getByText(/林远山（主角）/)).toBeInTheDocument();
  });

  it("展开注入设置：四行开关/预算按每书配置回显", async () => {
    await openSettings();
    expect(api.contextConfigGet).toHaveBeenCalledWith(1);
    expect(screen.getByTestId("inj-toggle-characters")).toBeChecked();
    expect(screen.getByTestId("inj-toggle-foreshadows")).toBeChecked();
    expect(screen.getByTestId("inj-toggle-plots")).not.toBeChecked();
    expect(screen.getByTestId("inj-toggle-ideas")).not.toBeChecked();
    expect(screen.getByTestId("inj-budget-characters")).toHaveValue(1500);
  });

  it("开启情节块槽位：保存更新后的配置并触发 onChanged", async () => {
    const onChanged = vi.fn();
    await openSettings(onChanged);

    fireEvent.click(screen.getByTestId("inj-toggle-plots"));
    await waitFor(() =>
      expect(api.contextConfigSet).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ plots: expect.objectContaining({ enabled: true, budget: 1000 }) }),
      ),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("预算改 0 = 不限：负数与空输入钳到 0", async () => {
    await openSettings();
    fireEvent.change(screen.getByTestId("inj-budget-characters"), { target: { value: "-3" } });
    await waitFor(() =>
      expect(api.contextConfigSet).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ characters: expect.objectContaining({ budget: 0 }) }),
      ),
    );
  });

  it("情节块勾选：全部态点单项收窄为 ids，再点全部回 null", async () => {
    const enabledPlots: ContextConfig = {
      ...DEFAULT_CFG,
      plots: { enabled: true, budget: 1000, ids: null, all: false },
    };
    (api.contextConfigGet as ReturnType<typeof vi.fn>).mockResolvedValue(enabledPlots);
    await openSettings();

    // ids=null（全部）下点单项 201 → 全集去它 = [202]
    fireEvent.click(screen.getByTestId("inj-item-plots-201"));
    await waitFor(() =>
      expect(api.contextConfigSet).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ plots: expect.objectContaining({ ids: [202] }) }),
      ),
    );

    // 勾选态下点「全部」→ ids 回 null
    fireEvent.click(screen.getByTestId("inj-all-plots"));
    await waitFor(() =>
      expect(api.contextConfigSet).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ plots: expect.objectContaining({ ids: null }) }),
      ),
    );
  });
});
