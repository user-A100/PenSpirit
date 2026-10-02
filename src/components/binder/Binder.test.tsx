import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { Binder, binderMatch } from "./Binder";
import { MenuHost } from "../ui/MenuHost";
import { useWorkspace } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { useMeta } from "../../stores/meta";
import { useCollections } from "../../stores/collections";
import { useGroupView } from "../../stores/groupView";
import { useConfirmStore } from "../../stores/confirm";
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
    collectionRemoveChapter: vi.fn().mockResolvedValue([]),
    collectionAddChapters: vi.fn().mockResolvedValue([]),
    chapterUpdateMeta: vi.fn(),
    deleteChapter: vi.fn().mockResolvedValue(undefined),
  },
}));

const BOOK = { id: 1, slug: "shu", title: "红楼梦", created_at: "", updated_at: "", target_words: null };
const ch = (id: number, title: string, extra: Partial<ChapterMeta> = {}): ChapterMeta => ({
  id, book_id: 1, file_path: "", title, sort_key: id, word_count: 0, created_at: "", updated_at: "",
  synopsis: "", label_id: null, status_id: null, target_words: null, ...extra,
});
const CHS = [ch(11, "初见"), ch(12, "别离", { synopsis: "雪夜送别" }), ch(13, "重逢", { label_id: 1 }), ch(14, "风波", { status_id: 2 }), ch(15, "尾声", { word_count: 500, target_words: 1000 })];
const LABELS = [{ id: 1, book_id: 1, title: "主线", color: "#e11d48", sort_key: 0, created_at: "" }];
const STATUSES = [{ id: 2, book_id: 1, title: "初稿", sort_key: 0, created_at: "" }];

const row = (title: string) => screen.getByText(title).closest("[data-chapter-row]") as HTMLElement;
const titles = () => [...document.querySelectorAll("[data-chapter-row]")].map((r) => r.querySelector("span.truncate")?.textContent);

let selectChapter: Mock;
let reorderChapters: Mock;
let applyTree: Mock;

beforeEach(() => {
  selectChapter = vi.fn(async (id: number) => {
    useWorkspace.setState({ currentChapterId: id });
  });
  reorderChapters = vi.fn(async () => {});
  applyTree = vi.fn(async () => true);
  useWorkspace.setState({ books: [BOOK], chapters: CHS, volumes: [], currentBookId: 1, currentChapterId: 11, activePane: "a", selectChapter, reorderChapters, applyTree });
  useBinder.setState({ selected: [], anchor: null, filter: "", scope: { kind: "book" }, renaming: null, revealSeq: 0 });
  useMeta.setState({ labels: LABELS, statuses: STATUSES });
  useGroupView.setState({ modes: { a: "single", b: "single" }, preferred: "corkboard" });
  useCollections.setState({ bookId: 1, list: [], members: {} });
  useConfirmStore.setState({ queue: [] });
});

describe("binderMatch（过滤命中）", () => {
  it("标题子串 / 拼音首字母 / 梗概 / 标签名 / 状态名", () => {
    const m = (c: ChapterMeta, q: string) => binderMatch(c, q, LABELS, STATUSES);
    expect(m(CHS[0], "初")).toBe(true);
    expect(m(CHS[0], "cj")).toBe(true);
    expect(m(CHS[1], "雪夜")).toBe(true);
    expect(m(CHS[2], "主线")).toBe(true);
    expect(m(CHS[3], "初稿")).toBe(true);
    expect(m(CHS[4], "cj")).toBe(false);
    expect(m(CHS[4], "  ")).toBe(true);
  });
});

describe("Binder 选择模型", () => {
  it("单击 = 选中并打开；Ctrl 点击加选并切到组视图（只动活动窗格）；Shift 以锚点连选", async () => {
    render(<Binder />);
    fireEvent.click(row("别离"));
    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith(12));
    expect(useBinder.getState().selected).toEqual([12]);

    fireEvent.click(row("风波"), { ctrlKey: true });
    expect(useBinder.getState().selected).toEqual([12, 14]);
    expect(useGroupView.getState().modes).toEqual({ a: "corkboard", b: "single" });

    // 锚点 = 最后一次 Ctrl 点击的「风波」
    fireEvent.click(row("尾声"), { shiftKey: true });
    expect(useBinder.getState().selected).toEqual([14, 15]);
    expect(row("尾声").getAttribute("aria-selected")).toBe("true");
  });

  it("选区为空时 Ctrl 点击以当前章为起点", () => {
    render(<Binder />);
    useBinder.setState({ selected: [], anchor: null });
    fireEvent.click(row("重逢"), { ctrlKey: true });
    expect(useBinder.getState().selected).toEqual([11, 13]);
  });
});

describe("Binder 键盘", () => {
  it("↓ 选中并打开、Shift+↓ 扩选、Ctrl+↑ 整体上移、Ctrl+A 全选、Esc 收拢到当前章", async () => {
    render(<Binder />);
    fireEvent.keyDown(row("初见"), { key: "ArrowDown" });
    await waitFor(() => expect(selectChapter).toHaveBeenCalledWith(12));

    fireEvent.keyDown(row("别离"), { key: "ArrowDown", shiftKey: true });
    expect(useBinder.getState().selected).toEqual([12, 13]);

    fireEvent.keyDown(row("重逢"), { key: "ArrowUp", ctrlKey: true });
    // 阶段 3B：同级移位走树操作
    expect(applyTree).toHaveBeenCalledWith([12, 13, 11, 14, 15].map((id) => ({ id, parent_id: null })));

    fireEvent.keyDown(row("重逢"), { key: "a", ctrlKey: true });
    expect(useBinder.getState().selected).toEqual([11, 12, 13, 14, 15]);

    fireEvent.keyDown(row("重逢"), { key: "Escape" });
    expect(useBinder.getState().selected).toEqual([12]);
  });

  it("F2 改名；Del 单章直接进回收站，多章先确认", async () => {
    const { api } = await import("../../lib/tauri");
    render(<Binder />);
    fireEvent.keyDown(row("别离"), { key: "F2" });
    expect(useBinder.getState().renaming).toEqual({ kind: "chapter", id: 12 });
    fireEvent.keyDown(await screen.findByLabelText("新名称"), { key: "Escape" });

    fireEvent.keyDown(row("尾声"), { key: "Delete" });
    await waitFor(() => expect(api.deleteChapter).toHaveBeenCalledWith(15));

    useBinder.getState().setSelection([11, 12], [11, 12, 13, 14]);
    fireEvent.keyDown(row("初见"), { key: "Delete" });
    await waitFor(() => expect(useConfirmStore.getState().queue).toHaveLength(1));
    expect(useConfirmStore.getState().queue[0].title).toContain("2 章");
    act(() => useConfirmStore.getState().answer(useConfirmStore.getState().queue[0].id, false));
    expect(api.deleteChapter).toHaveBeenCalledTimes(1);
  });
});

describe("Binder 右键批量赋值", () => {
  it("右键在选区内 → 菜单作用于整个选区（标签批量设置）；选区外只作用于该章", async () => {
    const { api } = await import("../../lib/tauri");
    (api.chapterUpdateMeta as Mock).mockImplementation(async (id: number, u: Partial<ChapterMeta>) => ({ ...ch(id, `章${id}`), ...u }));
    render(
      <>
        <Binder />
        <MenuHost />
      </>,
    );
    useBinder.getState().setSelection([12, 13, 14], CHS.map((c) => c.id));
    fireEvent.contextMenu(row("重逢"));
    fireEvent.click(await screen.findByText("标签（3 项）"));
    fireEvent.click(await screen.findByText("主线"));
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledTimes(3));
    expect(api.chapterUpdateMeta).toHaveBeenCalledWith(12, { label_id: 1 });
    expect(api.chapterUpdateMeta).toHaveBeenCalledWith(14, { label_id: 1 });
    await waitFor(() => expect(useWorkspace.getState().chapters.find((c) => c.id === 12)?.label_id).toBe(1));

    fireEvent.contextMenu(row("尾声"));
    expect(await screen.findByText("在另一窗格打开")).toBeInTheDocument();
    expect(screen.queryByText(/标签（/)).toBeNull();
  });
});

describe("Binder 过滤与定位", () => {
  it("过滤框按标题 / 拼音 / 梗概 / 标签 / 状态筛选，Esc 清除", () => {
    render(<Binder />);
    fireEvent.click(screen.getByLabelText("过滤章节"));
    const input = screen.getByLabelText("过滤章节关键词");
    fireEvent.change(input, { target: { value: "cj" } });
    expect(titles()).toEqual(["初见"]);
    fireEvent.change(input, { target: { value: "雪夜" } });
    expect(titles()).toEqual(["别离"]);
    fireEvent.change(input, { target: { value: "初稿" } });
    expect(titles()).toEqual(["风波"]);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(titles()).toHaveLength(5);
  });

  it("在目录中定位当前章：被过滤掉时清过滤、聚焦该行", async () => {
    render(<Binder />);
    act(() => useBinder.getState().setFilter("风波"));
    expect(titles()).toEqual(["风波"]);
    act(() => useBinder.getState().reveal());
    await waitFor(() => expect(useBinder.getState().filter).toBe(""));
    await waitFor(() => expect(document.activeElement).toBe(row("初见")));
  });

  it("行尾目标进度环", () => {
    render(<Binder />);
    expect(screen.getByLabelText("500 / 1,000 字（50%）")).toBeInTheDocument();
    expect(screen.getByLabelText("状态：初稿")).toBeInTheDocument();
  });
});

describe("Binder 集合作用域", () => {
  it("集合标签页：切到手动集合 → 列表 = 集合成员（集合序），Del = 移出集合", async () => {
    const { api } = await import("../../lib/tauri");
    (api.collectionsList as Mock).mockResolvedValue([
      { id: 7, book_id: 1, name: "反派线", kind: "manual", query: "", created_at: "", updated_at: "" },
      { id: 8, book_id: 1, name: "雪", kind: "saved", query: "雪", created_at: "", updated_at: "" },
    ]);
    (api.collectionChapters as Mock).mockResolvedValue([ch(13, "重逢"), ch(11, "初见")]);
    render(<Binder />);
    fireEvent.click(await screen.findByRole("tab", { name: /反派线/ }));
    await waitFor(() => expect(titles()).toEqual(["重逢", "初见"]));
    expect(useBinder.getState().scope).toMatchObject({ kind: "collection", id: 7 });

    fireEvent.keyDown(row("重逢"), { key: "Delete" });
    await waitFor(() => expect(api.collectionRemoveChapter).toHaveBeenCalledWith(7, 13));
    expect(api.deleteChapter).not.toHaveBeenCalled();

    // 回到全书
    fireEvent.click(screen.getByRole("tab", { name: /全书/ }));
    expect(titles()).toHaveLength(5);
  });
});
