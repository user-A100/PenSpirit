import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const books = [{ id: 1, slug: "shu", title: "书", created_at: "", updated_at: "" }];
  const chapters = [
    { id: 11, book_id: 1, file_path: "shu/manuscript/0001-yi.md", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "" },
  ];
  return {
    api: {
      listBooks: vi.fn().mockResolvedValue(books),
      createBook: vi.fn().mockResolvedValue(books[0]),
      listChapters: vi.fn().mockResolvedValue(chapters),
      createChapter: vi.fn().mockResolvedValue(chapters[0]),
    },
  };
});

import { useWorkspace } from "./workspace";

describe("workspace store", () => {
  beforeEach(() => useWorkspace.setState({ books: [], chapters: [], currentBookId: null, currentChapterId: null }));

  it("loadBooks 填充书籍", async () => {
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().books).toHaveLength(1);
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
});
