import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => {
  const books = [{ id: 1, slug: "shu", title: "书", created_at: "", updated_at: "", target_words: null }];
  const chapters = [
    { id: 11, book_id: 1, file_path: "shu/manuscript/0001-yi.md", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "" },
    { id: 12, book_id: 1, file_path: "shu/manuscript/0002-er.md", title: "二", sort_key: 2, word_count: 0, created_at: "", updated_at: "" },
    { id: 13, book_id: 1, file_path: "shu/manuscript/0003-san.md", title: "三", sort_key: 3, word_count: 0, created_at: "", updated_at: "" },
  ];
  return {
    api: {
      listBooks: vi.fn().mockResolvedValue(books),
      createBook: vi.fn().mockResolvedValue(books[0]),
      listChapters: vi.fn().mockResolvedValue(chapters),
      createChapter: vi.fn().mockResolvedValue(chapters[0]),
      readChapter: vi.fn().mockImplementation(async (id: number) => ({ meta: chapters[0], content: `正文-${id}` })),
      reorderChapters: vi.fn().mockResolvedValue(undefined),
    },
  };
});

import { useWorkspace } from "./workspace";

const freshPanes = () => ({
  a: { chapterId: null, content: null },
  b: { chapterId: null, content: null },
});

describe("workspace store", () => {
  beforeEach(() =>
    useWorkspace.setState({
      books: [], chapters: [], currentBookId: null, currentChapterId: null, chapterContent: null,
      splitAxis: "none", panes: freshPanes(), activePane: "a", history: [], historyIndex: -1,
    }),
  );

  it("loadBooks 填充书籍", async () => {
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().books).toHaveLength(1);
  });

  it("冷启动自动选中上次的书（localStorage 记忆）", async () => {
    localStorage.setItem("bixian.lastBookId", "1");
    await useWorkspace.getState().loadBooks();
    expect(useWorkspace.getState().currentBookId).toBe(1);
    expect(useWorkspace.getState().chapters).toHaveLength(3);
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
    expect(useWorkspace.getState().chapters).toHaveLength(3);
  });

  it("createChapter 后刷新章节列表", async () => {
    await useWorkspace.getState().selectBook(1);
    await useWorkspace.getState().createChapter("二");
    expect(useWorkspace.getState().chapters).toHaveLength(3); // mock 返回同列表
  });

  it("selectChapter 异步读取章节内容", async () => {
    await useWorkspace.getState().selectChapter(11);
    expect(useWorkspace.getState().currentChapterId).toBe(11);
    expect(useWorkspace.getState().chapterContent).toBe("正文-11");
    expect(useWorkspace.getState().panes.a).toEqual({ chapterId: 11, content: "正文-11" });
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

  // ---- M7 批次5：导航历史与分屏 ----

  it("selectChapter 压历史；goBack/goForward 走栈不压栈；新跳转截断前进分支", async () => {
    await useWorkspace.getState().selectBook(1);
    const s = useWorkspace.getState();
    await s.selectChapter(11);
    await s.selectChapter(12);
    await s.selectChapter(13);
    expect(useWorkspace.getState().currentChapterId).toBe(13);
    expect(useWorkspace.getState().history).toEqual([11, 12, 13]);
    expect(useWorkspace.getState().historyIndex).toBe(2);

    await useWorkspace.getState().goBack();
    expect(useWorkspace.getState().currentChapterId).toBe(12);
    expect(useWorkspace.getState().chapterContent).toBe("正文-12");
    // 回退不压栈
    expect(useWorkspace.getState().history).toEqual([11, 12, 13]);

    await useWorkspace.getState().goBack();
    await useWorkspace.getState().goForward();
    expect(useWorkspace.getState().currentChapterId).toBe(12);

    // 从栈中间（12）跳已访问的 11 → 前进分支（13）被截断；连续重复 11 不重复压
    await useWorkspace.getState().selectChapter(11);
    expect(useWorkspace.getState().history).toEqual([11, 12, 11]);
    await useWorkspace.getState().goForward();
    // 没有前进可走，保持原章
    expect(useWorkspace.getState().currentChapterId).toBe(11);

    // 栈底再后退是空操作（回退两次到 idx0=11 后原地不动）
    await useWorkspace.getState().goBack();
    await useWorkspace.getState().goBack();
    expect(useWorkspace.getState().currentChapterId).toBe(11);
  });

  it("focusPane 切活动窗格并同步镜像；分屏关闭时焦点归位 a", async () => {
    await useWorkspace.getState().selectBook(1);
    await useWorkspace.getState().selectChapter(11);

    useWorkspace.getState().focusPane("b");
    // b 还是空窗格
    expect(useWorkspace.getState().currentChapterId).toBeNull();

    await useWorkspace.getState().selectChapter(12);
    expect(useWorkspace.getState().panes.b).toEqual({ chapterId: 12, content: "正文-12" });
    // a 槽位不被 b 的装载覆盖
    expect(useWorkspace.getState().panes.a).toEqual({ chapterId: 11, content: "正文-11" });
    expect(useWorkspace.getState().chapterContent).toBe("正文-12");

    useWorkspace.getState().focusPane("a");
    expect(useWorkspace.getState().currentChapterId).toBe(11);
    expect(useWorkspace.getState().chapterContent).toBe("正文-11");

    useWorkspace.getState().setSplitAxis("none");
    expect(useWorkspace.getState().activePane).toBe("a");
    expect(useWorkspace.getState().splitAxis).toBe("none");
  });

  it("cycleSplit 在 无→左右→上下→无 间循环", () => {
    expect(useWorkspace.getState().splitAxis).toBe("none");
    useWorkspace.getState().cycleSplit();
    expect(useWorkspace.getState().splitAxis).toBe("vertical");
    useWorkspace.getState().cycleSplit();
    expect(useWorkspace.getState().splitAxis).toBe("horizontal");
    useWorkspace.getState().cycleSplit();
    expect(useWorkspace.getState().splitAxis).toBe("none");
  });

  it("selectBook 重置分屏、窗格与历史", async () => {
    useWorkspace.setState({
      splitAxis: "vertical",
      panes: { a: { chapterId: 11, content: "x" }, b: { chapterId: 12, content: "y" } },
      activePane: "b",
      history: [11, 12],
      historyIndex: 1,
    });
    await useWorkspace.getState().selectBook(1);
    expect(useWorkspace.getState().splitAxis).toBe("none");
    expect(useWorkspace.getState().panes).toEqual(freshPanes());
    expect(useWorkspace.getState().activePane).toBe("a");
    expect(useWorkspace.getState().history).toEqual([]);
  });
});
