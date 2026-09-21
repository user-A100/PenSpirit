import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const books = [{ id: 1, slug: "shu", title: "书", created_at: "", updated_at: "", target_words: null }];
  const chapters = [
    { id: 11, book_id: 1, file_path: "shu/manuscript/0001-yi.md", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "" },
  ];
  return {
    api: {
      listBooks: vi.fn().mockResolvedValue(books),
      createBook: vi.fn().mockResolvedValue(books[0]),
      listChapters: vi.fn().mockResolvedValue(chapters),
      createChapter: vi.fn().mockResolvedValue(chapters[0]),
      readChapter: vi.fn().mockResolvedValue({ meta: chapters[0], content: "" }),
      reorderChapters: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { useWorkspace } from "./workspace";

describe("workspace store", () => {
  beforeEach(() => useWorkspace.setState({ books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null }));

  it("loadBooks 填充书籍", async () => {
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().books).toHaveLength(1);
  });

  it("冷启动自动选中上次的书（localStorage 记忆）", async () => {
    localStorage.setItem("bixian.lastBookId", "1");
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().currentBookId).toBe(1);
    expect(useWorkspace.getState().chapters).toHaveLength(1);
    localStorage.removeItem("bixian.lastBookId");
  });

  it("记忆的书不在列表时退到第一本；selectBook 写记忆", async () => {
    localStorage.setItem("bixian.lastBookId", "999");
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().currentBookId).toBe(1); // 退到第一本
    expect(localStorage.getItem("bixian.lastBookId")).toBe("1"); // selectBook 更新记忆
    localStorage.removeItem("bixian.lastBookId");
  });

  it("已有选中书时 loadBooks 不改选中", async () => {
    await useWorkspace.getState().selectBook(1);
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().currentBookId).toBe(1);
  });

  it("selectBook 加载章节并记住当前书", async () => {
    await useWorkspace.getState().selectBook(1);
    expect(useWorkspace.getState().currentBookId).toBe(1);
    expect(useWorkspace.getState().chapters).toHaveLength(1);
  });

  it("createChapter 后刷新章节列表", async () => {
    await useWorkspace.getState().selectBook(1);
    await useWorkspace.getState().createChapter("二");
    expect(useWorkspace.getState().chapters).toHaveLength(1); // mock 返回同列表
  });

  it("selectChapter 异步读取章节内容", async () => {
    await useWorkspace.getState().selectChapter(11);
    expect(useWorkspace.getState().currentChapterId).toBe(11);
    expect(useWorkspace.getState().chapterContent).toBe("");
  });

  it("reorderChapters 按传入 id 序乐观重排并调 API", async () => {
    useWorkspace.setState({ currentBookId: 1, chapters: [
      { id: 11, book_id: 1, file_path: "", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
      { id: 12, book_id: 1, file_path: "", title: "二", sort_key: 2, word_count: 0, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
      { id: 13, book_id: 1, file_path: "", title: "三", sort_key: 3, word_count: 0, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
    ] });
    await useWorkspace.getState().reorderChapters([13, 11, 12]);
    expect(useWorkspace.getState().chapters.map((c) => c.title)).toEqual(["三", "一", "二"]);
  });

  it("reorderChapters 失败回滚到重排前", async () => {
    const { api } = await import("../lib/tauri");
    (api.reorderChapters as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const before = [
      { id: 11, book_id: 1, file_path: "", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
      { id: 12, book_id: 1, file_path: "", title: "二", sort_key: 2, word_count: 0, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
    ];
    useWorkspace.setState({ currentBookId: 1, chapters: before });
    await useWorkspace.getState().reorderChapters([12, 11]);
    expect(useWorkspace.getState().chapters.map((c) => c.title)).toEqual(["一", "二"]);
    expect(useWorkspace.getState().error).toBeTruthy();
  });
});
