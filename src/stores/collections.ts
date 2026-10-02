import { create } from "zustand";
import { api, type ChapterMeta, type Collection } from "../lib/tauri";
import { errMsg } from "../lib/errors";
import { toast } from "./toast";

// 集合（阶段 3A 迁入 Binder）：列表与成员的读取带请求序号（换书/换集合时丢弃过期结果，
// 合并 codex 计划「刷新可靠性」）；成员写操作串行（进行中再点不会重复写），失败给提示不改视图。

interface CollectionsState {
  bookId: number | null;
  list: Collection[];
  /** collectionId → 成员（集合序） */
  members: Record<number, ChapterMeta[]>;
  busy: boolean;
  load: (bookId: number) => Promise<void>;
  loadMembers: (id: number) => Promise<ChapterMeta[] | null>;
  create: (name: string) => Promise<Collection | null>;
  rename: (id: number, name: string) => Promise<void>;
  remove: (id: number) => Promise<void>;
  addChapters: (id: number, chapterIds: number[]) => Promise<boolean>;
  removeChapter: (id: number, chapterId: number) => Promise<boolean>;
  reorder: (id: number, chapterIds: number[]) => Promise<boolean>;
}

let listSeq = 0;
const memberSeq = new Map<number, number>();
let writing = false;

export const useCollections = create<CollectionsState>((set, get) => {
  /** 串行写：进行中直接忽略；成功后重拉该集合成员 */
  const write = async (id: number, action: () => Promise<unknown>, okMsg?: string): Promise<boolean> => {
    if (writing) return false;
    writing = true;
    set({ busy: true });
    try {
      await action();
      if (okMsg) toast.success(okMsg);
      await get().loadMembers(id);
      return true;
    } catch (e) {
      toast.error(errMsg(e));
      return false;
    } finally {
      writing = false;
      set({ busy: false });
    }
  };

  return {
    bookId: null,
    list: [],
    members: {},
    busy: false,
    load: async (bookId) => {
      const seq = ++listSeq;
      if (get().bookId !== bookId) set({ bookId, list: [], members: {} });
      try {
        const list = await api.collectionsList(bookId);
        if (seq === listSeq && get().bookId === bookId) set({ list });
      } catch (e) {
        if (seq === listSeq) toast.error(`集合加载失败：${errMsg(e)}`);
      }
    },
    loadMembers: async (id) => {
      const seq = (memberSeq.get(id) ?? 0) + 1;
      memberSeq.set(id, seq);
      try {
        const ms = await api.collectionChapters(id);
        if (memberSeq.get(id) === seq) set((s) => ({ members: { ...s.members, [id]: ms } }));
        return ms;
      } catch (e) {
        if (memberSeq.get(id) === seq) toast.error(`集合成员加载失败：${errMsg(e)}`);
        return null;
      }
    },
    create: async (name) => {
      const bookId = get().bookId;
      if (bookId == null) return null;
      try {
        const c = await api.collectionUpsert({ id: null, book_id: bookId, name, kind: "manual", query: "" });
        await get().load(bookId);
        return c;
      } catch (e) {
        toast.error(errMsg(e));
        return null;
      }
    },
    rename: async (id, name) => {
      const c = get().list.find((x) => x.id === id);
      if (!c) return;
      try {
        await api.collectionUpsert({ id, book_id: c.book_id, name, kind: c.kind, query: c.query });
        await get().load(c.book_id);
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    remove: async (id) => {
      const bookId = get().bookId;
      try {
        await api.collectionDelete(id);
        set((s) => {
          const members = { ...s.members };
          delete members[id];
          return { members, list: s.list.filter((c) => c.id !== id) };
        });
        if (bookId != null) await get().load(bookId);
      } catch (e) {
        toast.error(errMsg(e));
      }
    },
    addChapters: (id, chapterIds) => {
      const name = get().list.find((c) => c.id === id)?.name ?? "";
      return write(id, () => api.collectionAddChapters(id, chapterIds), `已加入集合「${name}」`);
    },
    removeChapter: (id, chapterId) => write(id, () => api.collectionRemoveChapter(id, chapterId)),
    reorder: (id, chapterIds) => {
      // 乐观：先按新序显示，失败重拉回真值
      const cur = get().members[id];
      if (cur) {
        const pos = new Map(chapterIds.map((x, i) => [x, i]));
        set((s) => ({ members: { ...s.members, [id]: [...cur].sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0)) } }));
      }
      return write(id, () => api.collectionReorder(id, chapterIds));
    },
  };
});
