import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlotBlock } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: {
    plotBlocksList: vi.fn(),
    plotBlockUpsert: vi.fn(),
    plotBlockReorder: vi.fn(),
    plotBlockDelete: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { usePlotBlocks } from "../../stores/plotBlocks";
import { PlotBlocksPanel } from "./PlotBlocksPanel";

// ---- 夹具：后端序 idea → ready → used，同状态内 sort_key ----
function pb(p: Partial<PlotBlock> & Pick<PlotBlock, "id" | "content" | "status">): PlotBlock {
  return { book_id: 1, chapter_id: null, sort_key: 0, created_at: "2026-09-01 00:00:00", ...p };
}

const LIST: PlotBlock[] = [
  pb({ id: 201, content: "主角捡到黑铁令牌", status: "idea" }),
  pb({ id: 202, content: "雨夜客栈遇袭", status: "idea" }),
  pb({ id: 203, content: "黑市拍卖会冲突", status: "ready" }),
  pb({ id: 204, content: "开篇雪夜灭门", status: "used" }),
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.plotBlocksList as ReturnType<typeof vi.fn>).mockResolvedValue(LIST);
  (api.plotBlockUpsert as ReturnType<typeof vi.fn>).mockImplementation(async (input: { id: number | null }) =>
    LIST.find((b) => b.id === input.id) ?? pb({ id: 205, content: "", status: "idea" }),
  );
  (api.plotBlockReorder as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.plotBlockDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  useWorkspace.setState({ books: [], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
  usePlotBlocks.setState({ bookId: null, list: [] });
});

describe("PlotBlocksPanel", () => {
  it("三态列表：按徽章 tone 区分灵感/待用/已用，idea 组在前", async () => {
    const { container } = render(<PlotBlocksPanel />);

    for (const text of LIST.map((b) => b.content)) {
      expect(await screen.findByText(text)).toBeInTheDocument();
    }
    const tones = Array.from(container.querySelectorAll<HTMLElement>("[data-tone]")).map(
      (el) => el.dataset.tone,
    );
    // 渲染序 = 后端返回序：idea(blue)×2 → ready(amber) → used(green)
    expect(tones).toEqual(["blue", "blue", "amber", "green"]);
  });

  it("快速添加：Enter 提交 status=idea，成功后清空草稿", async () => {
    render(<PlotBlocksPanel />);
    await screen.findByText("黑市拍卖会冲突");

    const box = screen.getByPlaceholderText(/记一块情节灵感/);
    fireEvent.change(box, { target: { value: "结尾断崖留钩子" } });
    fireEvent.keyDown(box, { key: "Enter" });

    await waitFor(() =>
      expect(api.plotBlockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "结尾断崖留钩子", status: "idea", book_id: 1 }),
      ),
    );
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("点徽章循环流转：ready → used", async () => {
    render(<PlotBlocksPanel />);
    fireEvent.click(await screen.findByText("黑市拍卖会冲突", { selector: "div" }));

    // 徽章本身是可点按钮（含文案"待用›"）
    fireEvent.click(screen.getByRole("button", { name: /待用/ }));
    await waitFor(() =>
      expect(api.plotBlockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: 203, status: "used" }),
      ),
    );
  });

  it("上移换序：与相邻块交换后 plotBlockReorder 收到新 id 序", async () => {
    render(<PlotBlocksPanel />);
    await screen.findByText("雨夜客栈遇袭");

    // 202（下标 1）上移 → [202, 201, 203, 204]
    const row = screen.getByText("雨夜客栈遇袭").closest("li")!;
    fireEvent.click(within(row).getByTitle("上移"));
    await waitFor(() => expect(api.plotBlockReorder).toHaveBeenCalledWith([202, 201, 203, 204]));
  });

  it("未选书时空态", async () => {
    useWorkspace.setState({ currentBookId: null });
    render(<PlotBlocksPanel />);
    expect(await screen.findByText("先选一本书")).toBeInTheDocument();
    expect(api.plotBlocksList).not.toHaveBeenCalled();
  });
});
