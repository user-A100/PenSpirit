import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { GroupView } from "./GroupView";
import { useWorkspace } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { useGroupView } from "../../stores/groupView";
import { useCollections } from "../../stores/collections";
import { useMeta } from "../../stores/meta";
import type { ChapterMeta } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    labelsList: vi.fn().mockResolvedValue([]),
    statusesList: vi.fn().mockResolvedValue([]),
    keywordsList: vi.fn().mockResolvedValue([]),
    keywordsForChapter: vi.fn().mockResolvedValue([]),
    customDefsList: vi.fn().mockResolvedValue([]),
    customValuesGet: vi.fn().mockResolvedValue({}),
    templatesList: vi.fn().mockResolvedValue([]),
    readChapter: vi.fn(),
    freeformPositions: vi.fn().mockResolvedValue([]),
    collectionReorder: vi.fn().mockResolvedValue([]),
    collectionChapters: vi.fn().mockResolvedValue([]),
  },
}));

const BOOK = { id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "", target_words: null };
const ch = (id: number, title: string, word_count = 100): ChapterMeta => ({
  id, book_id: 1, file_path: "", title, sort_key: id, word_count, created_at: "", updated_at: "",
  synopsis: "", label_id: null, status_id: null, target_words: null,
});
const CHS = [ch(11, "甲"), ch(12, "乙"), ch(13, "丙"), ch(14, "丁")];

let reorderChapters: Mock;
beforeEach(() => {
  reorderChapters = vi.fn(async () => {});
  useWorkspace.setState({ books: [BOOK], chapters: CHS, currentBookId: 1, currentChapterId: 11, activePane: "a", reorderChapters });
  useBinder.setState({ selected: [], anchor: null, filter: "", scope: { kind: "book" } });
  useGroupView.setState({ modes: { a: "outliner", b: "single" }, preferred: "outliner" });
  useCollections.setState({ bookId: 1, list: [], members: {} });
  useMeta.setState({ labels: [], statuses: [] });
});

const outlinerRows = (container: HTMLElement) => [...container.querySelectorAll(".flex-1.overflow-y-auto > div")] as HTMLElement[];

describe("组视图", () => {
  it("无多选 = 整本书；表头显示章数与合计字数", () => {
    const { container } = render(<GroupView pane="a" mode="outliner" />);
    expect(screen.getByText("《红楼梦》全书")).toBeInTheDocument();
    expect(screen.getByText("4 章 · 400 字")).toBeInTheDocument();
    expect(outlinerRows(container)).toHaveLength(4);
  });

  it("多选 = 只看选中章；子集内拖拽换序并回全书目录序", () => {
    useBinder.setState({ selected: [12, 14] });
    const { container } = render(<GroupView pane="a" mode="outliner" />);
    expect(screen.getByText("已选 2 章")).toBeInTheDocument();
    const rows = outlinerRows(container);
    expect(rows).toHaveLength(2);
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    // 子集 [乙,丁] → [丁,乙]，按位置填回全序
    expect(reorderChapters).toHaveBeenCalledWith([11, 14, 13, 12]);
  });

  it("搜索集合作用域只读（不可拖拽）", () => {
    useBinder.setState({ scope: { kind: "collection", id: 8, name: "雪", collectionKind: "saved", query: "雪" } });
    useCollections.setState({ members: { 8: [ch(13, "丙"), ch(11, "甲")] } });
    const { container } = render(<GroupView pane="a" mode="outliner" />);
    expect(screen.getByText("集合「雪」")).toBeInTheDocument();
    const rows = outlinerRows(container);
    expect(rows.map((r) => r.querySelector("span.flex-1")?.textContent)).toEqual(["丙", "甲"]);
    expect(rows[0].getAttribute("draggable")).toBe("false");
    expect(screen.getByText("只读")).toBeInTheDocument();
  });

  it("模式分段切换只改本窗格；关闭按钮回到单章", () => {
    render(<GroupView pane="a" mode="outliner" />);
    fireEvent.click(screen.getByRole("radio", { name: "卡片墙" }));
    expect(useGroupView.getState().modes).toEqual({ a: "corkboard", b: "single" });
    fireEvent.click(screen.getByLabelText("回到单章正文"));
    expect(useGroupView.getState().modes.a).toBe("single");
  });
});
