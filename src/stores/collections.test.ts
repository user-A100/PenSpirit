import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tauri", () => ({
  api: {
    collectionsList: vi.fn(),
    collectionChapters: vi.fn(),
    collectionUpsert: vi.fn(),
    collectionDelete: vi.fn(),
    collectionAddChapters: vi.fn(),
    collectionRemoveChapter: vi.fn(),
    collectionReorder: vi.fn(),
  },
}));

import { api, type ChapterMeta } from "../lib/tauri";
import { useCollections } from "./collections";

const meta = { synopsis: "", label_id: null, status_id: null, target_words: null };
const ch = (id: number): ChapterMeta => ({ id, book_id: 1, file_path: "", title: `章${id}`, sort_key: id, word_count: 0, created_at: "", updated_at: "", ...meta });

describe("collections store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCollections.setState({ bookId: null, list: [], members: {}, busy: false });
  });

  it("成员读取丢弃过期结果（先发后到不覆盖新结果）", async () => {
    let resolveFirst!: (v: ChapterMeta[]) => void;
    vi.mocked(api.collectionChapters)
      .mockReturnValueOnce(new Promise((r) => (resolveFirst = r)))
      .mockResolvedValueOnce([ch(2)]);
    const p1 = useCollections.getState().loadMembers(1);
    await useCollections.getState().loadMembers(1);
    resolveFirst([ch(1)]);
    await p1;
    expect(useCollections.getState().members[1].map((c) => c.id)).toEqual([2]);
  });

  it("写操作串行：进行中再点不重复写；成功后重拉成员", async () => {
    let resolveWrite!: (v: number[]) => void;
    vi.mocked(api.collectionReorder).mockReturnValue(new Promise((r) => (resolveWrite = r)));
    vi.mocked(api.collectionChapters).mockResolvedValue([ch(2), ch(1)]);
    useCollections.setState({ members: { 1: [ch(1), ch(2)] } });
    const p = useCollections.getState().reorder(1, [2, 1]);
    expect(useCollections.getState().members[1].map((c) => c.id)).toEqual([2, 1]); // 乐观
    expect(await useCollections.getState().reorder(1, [1, 2])).toBe(false);
    resolveWrite([2, 1]);
    expect(await p).toBe(true);
    expect(api.collectionReorder).toHaveBeenCalledTimes(1);
    expect(api.collectionChapters).toHaveBeenCalledWith(1);
  });

  it("写失败：提示并重拉不了时保持（返回 false）", async () => {
    vi.mocked(api.collectionAddChapters).mockRejectedValue({ code: "invalid", message: "跨书章节不能加入" });
    expect(await useCollections.getState().addChapters(1, [9])).toBe(false);
    expect(useCollections.getState().busy).toBe(false);
  });
});
