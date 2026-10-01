import { beforeEach, describe, expect, it, vi } from "vitest";

const meta = { synopsis: "", label_id: null, status_id: null, target_words: null };
const chapters = [
  { id: 11, book_id: 1, file_path: "a", title: "一", sort_key: 1, word_count: 0, created_at: "", updated_at: "", ...meta },
  { id: 12, book_id: 1, file_path: "b", title: "二", sort_key: 2, word_count: 0, created_at: "", updated_at: "", ...meta },
  { id: 13, book_id: 1, file_path: "c", title: "三", sort_key: 3, word_count: 0, created_at: "", updated_at: "", ...meta },
];
const lastToast = () => {
  const ts = useToasts.getState().toasts;
  return ts[ts.length - 1];
};

vi.mock("../lib/tauri", () => ({
  api: {
    deleteChapter: vi.fn().mockResolvedValue(undefined),
    readChapter: vi.fn().mockImplementation(async (id: number) => ({ meta: {}, content: `正文-${id}` })),
    listChapters: vi.fn(),
    listNodes: vi.fn(),
    createChapter: vi.fn(),
    chapterCreateAt: vi.fn(),
    reorderChapters: vi.fn().mockResolvedValue(undefined),
    renameChapter: vi.fn(),
  },
}));
vi.mock("../lib/tauri_trash", () => ({ trashApi: { restoreChapter: vi.fn().mockResolvedValue(undefined) } }));

import { api } from "../lib/tauri";
import { trashApi } from "../lib/tauri_trash";
import { useWorkspace } from "./workspace";
import { useToasts } from "./toast";

const panes = () => ({ a: { chapterId: null, content: null }, b: { chapterId: null, content: null } });

describe("workspace 章节增删改", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToasts.getState().clear();
    useWorkspace.setState({
      books: [], chapters: [...chapters], currentBookId: 1, currentChapterId: null, chapterContent: null,
      splitAxis: "none", panes: panes(), activePane: "a", history: [], historyIndex: -1,
    });
  });

  it("删除正在看的章：移出列表、打开下一章、历史抹去它、toast 可撤销", async () => {
    const ws = useWorkspace.getState();
    await ws.selectChapter(11);
    await ws.selectChapter(12);
    expect(useWorkspace.getState().history).toEqual([11, 12]);

    await useWorkspace.getState().deleteChapter(12);
    const st = useWorkspace.getState();
    expect(api.deleteChapter).toHaveBeenCalledWith(12);
    expect(st.chapters.map((c) => c.id)).toEqual([11, 13]);
    expect(st.currentChapterId).toBe(13); // 原位置的下一章
    expect(st.history).toEqual([11, 13]);

    const t = lastToast();
    expect(t.message).toContain("二");
    vi.mocked(api.listNodes).mockResolvedValue(chapters);
    await t.action!.run();
    expect(trashApi.restoreChapter).toHaveBeenCalledWith(12);
    expect(useWorkspace.getState().chapters.map((c) => c.id)).toEqual([11, 12, 13]);
  });

  it("删除末章时打开前一章", async () => {
    await useWorkspace.getState().selectChapter(13);
    await useWorkspace.getState().deleteChapter(13);
    expect(useWorkspace.getState().currentChapterId).toBe(12);
  });

  it("新建章插到指定章之后并选中（后端一步落位）", async () => {
    const created = { ...chapters[0], id: 14, title: "新章节", sort_key: 4 };
    vi.mocked(api.chapterCreateAt).mockResolvedValue(created);
    vi.mocked(api.listNodes).mockResolvedValueOnce([chapters[0], created, chapters[1], chapters[2]]);
    const got = await useWorkspace.getState().createChapter("新章节", { afterId: 11, select: true });
    expect(got?.id).toBe(14);
    expect(api.chapterCreateAt).toHaveBeenCalledWith(1, "新章节", 11, null);
    expect(useWorkspace.getState().chapters.map((c) => c.id)).toEqual([11, 14, 12, 13]);
    expect(useWorkspace.getState().currentChapterId).toBe(14);
  });

  it("重命名：同名/空名不调后端；失败给 toast 不改列表", async () => {
    expect(await useWorkspace.getState().renameChapter(11, "一")).toBe(false);
    expect(await useWorkspace.getState().renameChapter(11, "  ")).toBe(false);
    expect(api.renameChapter).not.toHaveBeenCalled();

    vi.mocked(api.renameChapter).mockRejectedValueOnce({ code: "invalid", message: "目标文件名已存在" });
    expect(await useWorkspace.getState().renameChapter(11, "二")).toBe(false);
    expect(lastToast()?.message).toContain("目标文件名已存在");
    expect(useWorkspace.getState().chapters[0].title).toBe("一");
  });
});
