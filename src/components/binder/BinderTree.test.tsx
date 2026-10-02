import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Binder } from "./Binder";
import { useWorkspace } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { useMeta } from "../../stores/meta";
import { useCollections } from "../../stores/collections";
import { useGroupView } from "../../stores/groupView";
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
    collectionsList: vi.fn().mockResolvedValue([]),
    collectionChapters: vi.fn().mockResolvedValue([]),
  },
}));

// 序章(1) / 第一卷(10)[甲(2), 乙(3)] / 第二卷(20)[丙(4)] / 尾声(5)
const BOOK = { id: 1, slug: "shu", title: "雪夜渡", created_at: "", updated_at: "", target_words: null };
const n = (id: number, title: string, sort: number, kind: "text" | "folder" = "text", parent: number | null = null, words = 100): ChapterMeta => ({
  id, book_id: 1, file_path: "", title, sort_key: sort, word_count: words, created_at: "", updated_at: "",
  synopsis: "", label_id: null, status_id: null, target_words: null, kind, parent_id: parent,
});
const VOLS = [n(10, "第一卷", 1, "folder", null, 0), n(20, "第二卷", 4, "folder", null, 0)];
const CHS = [n(1, "序章", 0), n(2, "甲", 2, "text", 10), n(3, "乙", 3, "text", 10), n(4, "丙", 5, "text", 20), n(5, "尾声", 6)];

const row = (title: string) => screen.getByText(title).closest("[data-chapter-row]") as HTMLElement;
const titles = () => [...document.querySelectorAll("[data-chapter-row]")].map((r) => r.querySelector("span.truncate")?.textContent);

let selectChapter: Mock;
let applyTree: Mock;

beforeEach(() => {
  localStorage.removeItem("bixian.binder.collapsed.1");
  selectChapter = vi.fn(async (id: number) => {
    useWorkspace.setState({ currentChapterId: id });
  });
  applyTree = vi.fn(async () => true);
  useWorkspace.setState({ books: [BOOK], chapters: CHS, volumes: VOLS, currentBookId: 1, currentChapterId: 1, activePane: "a", selectChapter, applyTree });
  useBinder.setState({ selected: [], anchor: null, filter: "", scope: { kind: "book" }, renaming: null, revealSeq: 0, hoist: null });
  useMeta.setState({ labels: [], statuses: [] });
  useGroupView.setState({ modes: { a: "single", b: "single" }, preferred: "corkboard" });
  useCollections.setState({ bookId: 1, list: [], members: {} });
});

describe("Binder 卷层级", () => {
  it("卷行 + 缩进的子章；卷字数 = 卷内合计；折叠隐藏子章并按书记忆", () => {
    render(<Binder />);
    expect(titles()).toEqual(["序章", "第一卷", "甲", "乙", "第二卷", "丙", "尾声"]);
    expect(row("甲").getAttribute("aria-level")).toBe("2");
    expect(row("第一卷").textContent).toContain("2 章");
    expect(row("第一卷").textContent).toContain("200");
    fireEvent.click(screen.getByLabelText("折叠「第一卷」"));
    expect(titles()).toEqual(["序章", "第一卷", "第二卷", "丙", "尾声"]);
    expect(JSON.parse(localStorage.getItem("bixian.binder.collapsed.1")!)).toEqual([10]);
  });

  it("单击卷 = 选中它并切到组视图（不改当前章）；← → 折叠 / 展开 / 回到所属卷", async () => {
    render(<Binder />);
    fireEvent.click(row("第一卷"));
    await waitFor(() => expect(useBinder.getState().selected).toEqual([10]));
    expect(useGroupView.getState().modes.a).toBe("corkboard");
    expect(selectChapter).not.toHaveBeenCalled();

    fireEvent.keyDown(row("第一卷"), { key: "ArrowLeft" });
    expect(titles()).not.toContain("甲");
    fireEvent.keyDown(row("第一卷"), { key: "ArrowRight" });
    expect(titles()).toContain("甲");
    fireEvent.keyDown(row("乙"), { key: "ArrowLeft" });
    await waitFor(() => expect(useBinder.getState().selected).toEqual([10]));
  });

  it("Ctrl+→ 并入上一卷、Ctrl+← 移出所在卷（走树操作）", async () => {
    render(<Binder />);
    fireEvent.keyDown(row("尾声"), { key: "ArrowRight", ctrlKey: true });
    await waitFor(() => expect(applyTree).toHaveBeenCalledTimes(1));
    expect(applyTree.mock.calls[0][0].map((i: { id: number; parent_id: number | null }) => `${i.parent_id ?? ""}>${i.id}`).join(" ")).toBe(
      ">1 >10 10>2 10>3 >20 20>4 20>5",
    );
    fireEvent.keyDown(row("甲"), { key: "ArrowLeft", ctrlKey: true });
    await waitFor(() => expect(applyTree).toHaveBeenCalledTimes(2));
    expect(applyTree.mock.calls[1][0].map((i: { id: number; parent_id: number | null }) => `${i.parent_id ?? ""}>${i.id}`).join(" ")).toBe(
      ">1 >10 10>3 >2 >20 20>4 >5",
    );
  });

  it("过滤保留所属卷（淡化），聚焦单卷只显示卷内章、可退出", () => {
    render(<Binder />);
    act(() => useBinder.getState().setFilter("丙"));
    expect(titles()).toEqual(["第二卷", "丙"]);
    expect(row("第二卷").className).toContain("opacity-50");
    act(() => useBinder.getState().setFilter(""));
    act(() => useBinder.getState().setHoist(10));
    expect(titles()).toEqual(["甲", "乙"]);
    fireEvent.click(screen.getByLabelText("退出聚焦"));
    expect(useBinder.getState().hoist).toBeNull();
    expect(titles()).toHaveLength(7);
  });
});
