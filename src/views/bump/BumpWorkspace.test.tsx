import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BumpWorkspace } from "./BumpWorkspace";
import { useBump } from "../../stores/bump";

vi.mock("../../lib/tauri", () => ({
  api: {
    bumpListWords: vi.fn(), bumpAddWord: vi.fn(), bumpDeleteWord: vi.fn(), bumpClearWords: vi.fn(),
    bumpDraw: vi.fn(), ideasList: vi.fn(), ideasCreate: vi.fn(), ideasDelete: vi.fn(),
  },
}));

import { api, type BumpWord } from "../../lib/tauri";

const W = (id: number, word: string): BumpWord => ({ id, word, created_at: "" });
const WORDS = [W(1, "蝴蝶"), W(2, "菜刀"), W(3, "铁锅")];

function mockBackend() {
  (api.bumpListWords as ReturnType<typeof vi.fn>).mockResolvedValue(WORDS);
  (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
}

describe("BumpWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBump.setState({
      words: [], ideas: [], drawn: [], count: 3, note: "", tags: "", busy: false, error: null,
    });
  });

  it("挂载即加载词库，渲染 chips 与数量", async () => {
    mockBackend();
    render(<BumpWorkspace />);

    expect(await screen.findByText("蝴蝶")).toBeInTheDocument();
    expect(screen.getByText("菜刀")).toBeInTheDocument();
    expect(api.bumpListWords).toHaveBeenCalled();
  });

  it("回车加词并向词库追加", async () => {
    mockBackend();
    (api.bumpAddWord as ReturnType<typeof vi.fn>).mockResolvedValue(W(4, "灯塔"));
    (api.bumpListWords as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(WORDS)
      .mockResolvedValue([...WORDS, W(4, "灯塔")]);
    render(<BumpWorkspace />);
    await screen.findByText("蝴蝶");

    const input = screen.getByPlaceholderText("加词，回车");
    fireEvent.change(input, { target: { value: "灯塔" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.bumpAddWord).toHaveBeenCalledWith("灯塔"));
    expect(await screen.findByText("灯塔")).toBeInTheDocument();
  });

  it("碰撞抽出词组并渲染大卡片，按钮改为换一组", async () => {
    mockBackend();
    (api.bumpDraw as ReturnType<typeof vi.fn>).mockResolvedValue(["蝴蝶", "铁锅", "雨夜"]);
    render(<BumpWorkspace />);
    await screen.findByText("蝴蝶");

    fireEvent.click(screen.getByText("碰撞"));

    expect(await screen.findByText("蝴蝶 × 铁锅 × 雨夜")).toBeInTheDocument();
    expect(screen.getByText("换一组")).toBeInTheDocument();
    expect(api.bumpDraw).toHaveBeenCalledWith(3); // 默认抽取 3 个
  });

  it("存为灵感卡：带备注与标签，成功后清空输入", async () => {
    mockBackend();
    (api.bumpDraw as ReturnType<typeof vi.fn>).mockResolvedValue(["雨夜", "邮差"]);
    (api.ideasCreate as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1, content: "一个念头", words_json: '["雨夜","邮差"]', tags_json: '["悬疑"]', created_at: "",
    });
    (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, content: "一个念头", words_json: '["雨夜","邮差"]', tags_json: '["悬疑"]', created_at: "" },
    ]);
    render(<BumpWorkspace />);
    await screen.findByText("蝴蝶");

    fireEvent.click(screen.getByText("碰撞"));
    await screen.findByText("雨夜 × 邮差");

    fireEvent.change(screen.getByPlaceholderText("备注（可选）"), { target: { value: "一个念头" } });
    fireEvent.change(screen.getByPlaceholderText("标签，空格分隔"), { target: { value: "悬疑" } });
    fireEvent.click(screen.getByText("存为灵感卡"));

    await waitFor(() =>
      expect(api.ideasCreate).toHaveBeenCalledWith("一个念头", '["雨夜","邮差"]', '["悬疑"]'),
    );
    // 卡片进入右侧陈列架
    expect(await screen.findByText("灵感卡")).toBeInTheDocument();
    expect((screen.getByPlaceholderText("备注（可选）") as HTMLInputElement).value).toBe("");
  });

  it("词库不足时禁用碰撞并给出提示", async () => {
    (api.bumpListWords as ReturnType<typeof vi.fn>).mockResolvedValue([W(1, "蝴蝶")]);
    (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<BumpWorkspace />);
    await screen.findByText("蝴蝶");

    expect(screen.getByText("碰撞").closest("button")).toBeDisabled();
    expect(screen.getByText(/词库至少需要 3 个词/)).toBeInTheDocument();
  });
});
