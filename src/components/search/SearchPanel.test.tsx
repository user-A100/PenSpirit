import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchPanel } from "./SearchPanel";
import { useSearch } from "../../stores/search";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({ api: { searchBook: vi.fn(), collectionUpsert: vi.fn() } }));

import { api, type SearchHit } from "../../lib/tauri";

function hit(chapterId: number, title: string, lineNo: number, line: string, start: number): SearchHit {
  return {
    chapter_id: chapterId, chapter_title: title, line_no: lineNo,
    line_text: line, match_start: start, match_end: start + 2, // 测试里查询词固定为「风雪」
  };
}

const HITS = [
  hit(11, "第一章", 1, "风雪很大。", 0),
  hit(11, "第一章", 5, "又是风雪。", 2),
  hit(12, "第二章", 2, "风雪夜归人。", 0),
];

describe("SearchPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearch.setState({
      open: true, query: "风雪", wholeWord: false, scope: "all", hits: [], truncated: false,
      loading: false, error: null, jumpText: null,
    });
    useWorkspace.setState({ currentBookId: 7 });
  });

  it("防抖后查询，结果按章分组并高亮命中", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: HITS, truncated: false });
    render(<SearchPanel />);

    await waitFor(() => expect(api.searchBook).toHaveBeenCalledWith(7, "风雪", false, "all"), { timeout: 2000 });
    expect(await screen.findByText(/第一章/)).toBeInTheDocument();
    expect(screen.getByText(/第二章/)).toBeInTheDocument();
    expect(screen.getByText("(2)")).toBeInTheDocument(); // 第一章 2 处
    expect(screen.getByText("(1)")).toBeInTheDocument(); // 第二章 1 处
    expect(screen.getAllByText("风雪").length).toBeGreaterThan(0); // 命中处高亮
    expect(screen.getByText(/共 3 处命中/)).toBeInTheDocument();
  });

  it("结果触顶时提示已截断", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: HITS, truncated: true });
    render(<SearchPanel />);
    expect(await screen.findByText(/结果过多，已截断/)).toBeInTheDocument();
  });

  it("无命中时提示未找到", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], truncated: false });
    render(<SearchPanel />);
    expect(await screen.findByText("没有找到匹配")).toBeInTheDocument();
  });

  it("点击结果跳到该章并把整行交给编辑器", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: HITS, truncated: false });
    const selectChapter = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ selectChapter });
    render(<SearchPanel />);

    // 三处命中各有一个跳转按钮，取第一个（第一章第 1 行）
    const [firstHit] = await screen.findAllByTitle("跳到此行");
    fireEvent.click(firstHit);

    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith(11));
    expect(useSearch.getState().jumpText).toBe("风雪很大。");
    expect(useSearch.getState().open).toBe(false);
  });

  it("Esc 关闭面板", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], truncated: false });
    render(<SearchPanel />);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(useSearch.getState().open).toBe(false));
  });

  it("切到标题范围后按新范围查询", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], truncated: false });
    render(<SearchPanel />);
    fireEvent.click(screen.getByTitle("仅搜章节标题"));
    await waitFor(() => expect(api.searchBook).toHaveBeenCalledWith(7, "风雪", false, "title"), { timeout: 2000 });
    expect(useSearch.getState().scope).toBe("title");
  });

  it("存为集合：把当前查询固化为搜索集合", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: HITS, truncated: false });
    (api.collectionUpsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 1, book_id: 7, name: "风雪", kind: "saved", query: "风雪", created_at: "", updated_at: "",
    });
    render(<SearchPanel />);

    await screen.findByText(/共 3 处命中/);
    fireEvent.click(screen.getByTitle(/把当前查询存为搜索集合/));
    await screen.findByText(/已存为集合「风雪」/);
    expect(api.collectionUpsert).toHaveBeenCalledWith({
      id: null, book_id: 7, name: "风雪", kind: "saved", query: "风雪",
    });
  });

  it("未打开时不渲染", () => {
    useSearch.setState({ open: false });
    render(<SearchPanel />);
    expect(screen.queryByTestId("search-backdrop")).not.toBeInTheDocument();
  });
});
