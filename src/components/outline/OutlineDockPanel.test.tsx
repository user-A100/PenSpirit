import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutlineDockPanel } from "./OutlineDockPanel";
import { useOutlinesStore } from "../../stores/outlines";
import { useWorkspace } from "../../stores/workspace";
import { api, type ChapterMeta, type Outline } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    outlinesList: vi.fn(),
    outlineUpsert: vi.fn(),
    outlineDelete: vi.fn(),
  },
}));

function ch(id: number, title: string): ChapterMeta {
  return { id, book_id: 1, title, sort_key: id, word_count: 0, file_path: "", created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null };
}

function o(partial: Partial<Outline> & Pick<Outline, "id" | "kind">): Outline {
  return {
    book_id: 1, chapter_id: null, title: "", content: "", sort_key: 0,
    created_at: "", updated_at: "", ...partial,
  };
}

describe("OutlineDockPanel（M4 大纲体系）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.setState({
      books: [],
      chapters: [ch(11, "风雪夜"), ch(12, "旧债")],
      currentBookId: 1,
      currentChapterId: 11,
      chapterContent: "## 出城\n\n雪很大。",
      selectChapter: vi.fn(),
    });
    useOutlinesStore.setState({ bookId: 1, list: [] });
    vi.mocked(api.outlinesList).mockResolvedValue([]);
  });

  it("渲染本章小标题 + 总纲未写占位 + 章细纲标记", async () => {
    vi.mocked(api.outlinesList).mockResolvedValue([
      o({ id: 1, kind: "chapter", chapter_id: 11, content: "要点" }),
    ]);
    render(<OutlineDockPanel />);
    await waitFor(() => expect(screen.getByText(/总纲（未写/)).toBeInTheDocument());
    expect(screen.getByText("出城")).toBeInTheDocument();
    expect(screen.getByTitle("编辑细纲")).toBeInTheDocument();
    expect(screen.getByTitle("写细纲")).toBeInTheDocument();
  });

  it("点总纲进编辑态，保存调用 outlineUpsert(master)", async () => {
    vi.mocked(api.outlineUpsert).mockResolvedValue(o({ id: 9, kind: "master", content: "主线" }));
    render(<OutlineDockPanel />);
    await waitFor(() => screen.getByText(/总纲（未写/));

    fireEvent.click(screen.getByText(/总纲（未写/));
    fireEvent.change(screen.getByPlaceholderText(/核心冲突/), { target: { value: "主线走向。" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(api.outlineUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, kind: "master", content: "主线走向。" }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/总纲（未写/)).toBeInTheDocument()); // 回树态
  });

  it("新建卷纲：卷名必填，保存带 sort_key", async () => {
    vi.mocked(api.outlineUpsert).mockResolvedValue(o({ id: 5, kind: "volume", title: "第一卷" }));
    render(<OutlineDockPanel />);
    await waitFor(() => screen.getByTitle("新建卷纲"));

    fireEvent.click(screen.getByTitle("新建卷纲"));
    fireEvent.click(screen.getByText("保存"));
    expect(screen.getByText("新建卷纲").className).toBeDefined(); // 仍在编辑态
    expect(api.outlineUpsert).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/卷名/), { target: { value: "第一卷 风雪" } });
    fireEvent.change(screen.getByPlaceholderText(/阶段目标/), { target: { value: "入局。" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(api.outlineUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "volume", title: "第一卷 风雪", sort_key: 1 }),
      ),
    );
  });

  it("点章行切章（目录语义保留），点笔图标进章细纲", async () => {
    vi.mocked(api.outlineUpsert).mockResolvedValue(o({ id: 7, kind: "chapter", chapter_id: 12 }));
    const sel = vi.fn();
    useWorkspace.setState({ selectChapter: sel });
    vi.mocked(api.outlinesList).mockResolvedValue([
      o({ id: 3, kind: "volume", title: "第一卷 风雪" }),
    ]);
    render(<OutlineDockPanel />);
    await waitFor(() => screen.getByText("第一卷 风雪"));

    // 章行点击 → 切章
    fireEvent.click(screen.getByText("2. 旧债"));
    expect(sel).toHaveBeenCalledWith(12);

    // 笔图标 → 细纲编辑
    fireEvent.click(screen.getAllByTitle("写细纲")[1]);
    fireEvent.change(screen.getByPlaceholderText(/本章细纲/), { target: { value: "追债夜。" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() =>
      expect(api.outlineUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "chapter", chapter_id: 12, content: "追债夜。" }),
      ),
    );
  });

  it("卷纲列表渲染已有卷并可删除", async () => {
    vi.mocked(api.outlinesList).mockResolvedValue([o({ id: 3, kind: "volume", title: "第一卷 风雪" })]);
    vi.mocked(api.outlineDelete).mockResolvedValue(undefined);
    render(<OutlineDockPanel />);
    await waitFor(() => screen.getByText("第一卷 风雪"));

    fireEvent.click(screen.getByText("第一卷 风雪"));
    fireEvent.click(screen.getByTitle("删除此大纲"));
    await waitFor(() => expect(api.outlineDelete).toHaveBeenCalledWith(3));
  });
});
