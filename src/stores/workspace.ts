import { create } from "zustand";
import { api, Book, ChapterMeta } from "../lib/tauri";
import { trashApi } from "../lib/tauri_trash";
import { errMsg } from "../lib/errors";
import { toast } from "./toast";

// M7 批次5：双编辑器分屏。pane a 是主编辑位（分屏关闭时的唯一编辑器），
// pane b 随分屏开启出现（初始为空，点进 b 窗格后从目录选章）。
// currentChapterId/chapterContent 始终镜像「活动窗格」——侧栏高亮、右侧 dock
// 面板、AI 会话因此天然跟随当前焦点窗格（Scrivener inspector 的跟随行为）。

export type SplitAxis = "none" | "vertical" | "horizontal";
export type PaneId = "a" | "b";

export interface PaneSlot {
  chapterId: number | null;
  content: string | null;
}

const EMPTY_PANE: PaneSlot = { chapterId: null, content: null };
const HISTORY_MAX = 100;

/** 节点拆成正文章与卷（各自保持全书先序） */
function splitNodes(nodes: ChapterMeta[]): { chapters: ChapterMeta[]; volumes: ChapterMeta[] } {
  return { chapters: nodes.filter((n) => n.kind !== "folder"), volumes: nodes.filter((n) => n.kind === "folder") };
}

interface WorkspaceState {
  books: Book[];
  /** 正文章（不含卷），全书先序——绝大多数调用方（搜索、AI、统计、命令面板…）只认它 */
  chapters: ChapterMeta[];
  /** 阶段 3B：卷（folder 节点），与 chapters 合起来是整棵树（parent_id / sort_key） */
  volumes: ChapterMeta[];
  currentBookId: number | null; currentChapterId: number | null;
  chapterContent: string | null;
  loading: boolean; error: string | null;
  /** 分屏方向：vertical=左右并排，horizontal=上下堆叠 */
  splitAxis: SplitAxis;
  panes: Record<PaneId, PaneSlot>;
  /** 活动窗格：目录点选与历史导航都写进它 */
  activePane: PaneId;
  /** 章节导航历史（浏览器式后退/前进；selectChapter 压栈，back/forward 不压栈） */
  history: number[];
  historyIndex: number;
  loadBooks: () => Promise<void>;
  selectBook: (id: number) => Promise<void>;
  createBook: (title: string) => Promise<void>;
  /** 新建章：afterId = 其后同级（为卷则卷后）；parentId = 该卷末尾；都无 = 全书末尾；select=true 时立即打开 */
  createChapter: (title: string, opts?: { afterId?: number | null; parentId?: number | null; select?: boolean }) => Promise<ChapterMeta | null>;
  /** 新建卷（阶段 3B）：childIds 非空 = 把这些章放入新卷 */
  createVolume: (title: string, opts?: { afterId?: number | null; childIds?: number[] }) => Promise<ChapterMeta | null>;
  /** 树操作（拖放 / 升降级 / 移位）：乐观更新，失败回滚 */
  applyTree: (items: { id: number; parent_id: number | null }[]) => Promise<boolean>;
  /** 元数据更新后把新行合进章或卷列表 */
  patchNodes: (metas: ChapterMeta[]) => void;
  /** 重命名章（磁盘文件随之改名）；失败 toast 并返回 false */
  renameChapter: (id: number, title: string) => Promise<boolean>;
  /** 删除章 = 移入回收站，toast 带「撤销」；删的是正在看的章则打开相邻章 */
  deleteChapter: (id: number) => Promise<boolean>;
  restoreChapter: (id: number) => Promise<void>;
  renameBook: (id: number, title: string) => Promise<boolean>;
  /** 删除书 = 移入书籍回收站，toast 带「撤销」 */
  deleteBook: (id: number) => Promise<boolean>;
  selectChapter: (id: number) => Promise<void>;
  setSplitAxis: (axis: SplitAxis) => void;
  cycleSplit: () => void;
  focusPane: (p: PaneId) => void;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  /** 乐观重排当前书章节（侧栏/卡片墙拖拽），失败回滚重拉 */
  reorderChapters: (ids: number[]) => Promise<void>;
  /** 重取当前书章节列表（不动选中章），回收站恢复后刷新用 */
  reloadChapters: () => Promise<void>;
}

/** 压入导航历史：截掉前进分支、连续重复不压、超上限丢最旧 */
function pushHistory(st: { history: number[]; historyIndex: number }, id: number) {
  const h = st.history.slice(0, st.historyIndex + 1);
  if (h[h.length - 1] === id) return {};
  h.push(id);
  const trimmed = h.length > HISTORY_MAX ? h.slice(h.length - HISTORY_MAX) : h;
  return { history: trimmed, historyIndex: trimmed.length - 1 };
}

export const useWorkspace = create<WorkspaceState>((set, get) => {
  // 把章读进活动窗格并同步镜像（历史压栈与否由调用方决定，这里只管装载）
  const loadIntoActive = async (id: number) => {
    const pane = get().activePane;
    // 换章时先清空正文槽位：编辑器在新内容到达前不会把上一章的正文当成这一章
    set((st) => {
      const same = st.panes[pane].chapterId === id;
      return {
        currentChapterId: id,
        chapterContent: same ? st.chapterContent : null,
        panes: { ...st.panes, [pane]: { chapterId: id, content: same ? st.panes[pane].content : null } },
      };
    });
    const full = await api.readChapter(id);
    set((st) => ({
      chapterContent: st.activePane === pane ? full.content : st.chapterContent,
      panes: { ...st.panes, [pane]: { ...st.panes[pane], content: full.content } },
    }));
  };

  return {
    books: [], chapters: [], volumes: [], currentBookId: null, currentChapterId: null, chapterContent: null, loading: false, error: null,
    splitAxis: "none",
    panes: { a: { ...EMPTY_PANE }, b: { ...EMPTY_PANE } },
    activePane: "a",
    history: [],
    historyIndex: -1,

    loadBooks: async () => {
      set({ loading: true, error: null });
      try {
        const books = await api.listBooks();
        set({ books, loading: false });
        // 冷启动自动恢复上次的书（localStorage 记忆；书没了/首次启动退到第一本）。
        // 没有这一步，伏笔/人物卡等面板会停在「请先选择书籍」、登记按钮永远灰着，
        // 用户视角即「功能不能用」。
        if (get().currentBookId == null && books.length > 0) {
          const last = Number(localStorage.getItem("bixian.lastBookId"));
          const restore = books.find((b) => b.id === last) ?? books[0];
          await get().selectBook(restore.id);
        }
      } catch (e) { set({ error: errMsg(e), loading: false }); }
    },
    selectBook: async (id) => {
      localStorage.setItem("bixian.lastBookId", String(id));
      // 换书收分屏、清历史：跨书的 pane 内容与回退没有意义
      set({
        currentBookId: id, currentChapterId: null, chapterContent: null,
        splitAxis: "none", panes: { a: { ...EMPTY_PANE }, b: { ...EMPTY_PANE } },
        activePane: "a", history: [], historyIndex: -1,
      });
      set(splitNodes(await api.listNodes(id)));
    },
    createBook: async (title) => {
      const book = await api.createBook(title);
      await get().loadBooks();
      await get().selectBook(book.id);
    },
    createChapter: async (title, opts) => {
      const bookId = get().currentBookId;
      if (bookId == null) return null;
      let created: ChapterMeta;
      try {
        // 阶段 3B：后端一步建在树中目标位置（同卷其后 / 卷末 / 全书末），并重编文件序号
        created = await api.chapterCreateAt(bookId, title, opts?.afterId ?? null, opts?.parentId ?? null);
      } catch (e) {
        toast.error(`新建章节失败：${errMsg(e)}`);
        return null;
      }
      const nodes = await api.listNodes(bookId);
      if (get().currentBookId !== bookId) return created;
      set(splitNodes(nodes));
      if (opts?.select) await get().selectChapter(created.id);
      return created;
    },
    createVolume: async (title, opts) => {
      const bookId = get().currentBookId;
      if (bookId == null) return null;
      try {
        const folder = await api.volumeCreate(bookId, title, opts?.afterId ?? null, opts?.childIds ?? []);
        if (get().currentBookId === bookId) set(splitNodes(await api.listNodes(bookId)));
        return folder;
      } catch (e) {
        toast.error(`新建卷失败：${errMsg(e)}`);
        return null;
      }
    },
    applyTree: async (items) => {
      const bookId = get().currentBookId;
      if (bookId == null) return false;
      const prev = { chapters: get().chapters, volumes: get().volumes };
      const place = new Map(items.map((it, i) => [it.id, { sort_key: i, parent_id: it.parent_id }]));
      const apply = (list: ChapterMeta[]) =>
        list
          .map((n) => (place.has(n.id) ? { ...n, ...place.get(n.id)! } : n))
          .sort((a, b) => a.sort_key - b.sort_key);
      set({ chapters: apply(prev.chapters), volumes: apply(prev.volumes) });
      try {
        await api.treeApply(bookId, items);
        return true;
      } catch (e) {
        if (get().currentBookId === bookId) set(prev);
        toast.error(`调整结构失败：${errMsg(e)}`);
        return false;
      }
    },
    patchNodes: (metas) => {
      const byId = new Map(metas.map((m) => [m.id, m]));
      const patch = (list: ChapterMeta[]) => list.map((c) => (byId.has(c.id) ? { ...c, ...byId.get(c.id)! } : c));
      set((s) => ({ chapters: patch(s.chapters), volumes: patch(s.volumes) }));
    },
    renameChapter: async (id, title) => {
      const t = title.trim();
      const cur = get().chapters.find((c) => c.id === id) ?? get().volumes.find((c) => c.id === id);
      if (!cur || t === "" || t === cur.title) return false;
      try {
        const meta = await api.renameChapter(id, t);
        // 卷改名会把卷内的章搬到新目录：整树重取；章改名只动自己
        if (cur.kind === "folder") await get().reloadChapters();
        else get().patchNodes([meta]);
        return true;
      } catch (e) {
        toast.error(`重命名失败：${errMsg(e)}`);
        return false;
      }
    },
    deleteChapter: async (id) => {
      const before = get();
      const folder = before.volumes.find((v) => v.id === id);
      if (folder) {
        // 删卷：卷内的章一并进回收站；撤销 = 先恢复卷、再恢复这些章（回到卷里）
        const kids = before.chapters.filter((c) => c.parent_id === id).map((c) => c.id);
        try {
          await api.deleteChapter(id);
        } catch (e) {
          toast.error(`删除失败：${errMsg(e)}`);
          return false;
        }
        await get().reloadChapters();
        const gone = new Set([id, ...kids]);
        set((st) => {
          const panes = { ...st.panes };
          for (const p of ["a", "b"] as PaneId[]) if (panes[p].chapterId != null && gone.has(panes[p].chapterId!)) panes[p] = { ...EMPTY_PANE };
          const kept = st.history.map((h, i) => ({ h, i })).filter((x) => !gone.has(x.h));
          const lost = st.currentChapterId != null && gone.has(st.currentChapterId);
          return {
            panes,
            currentChapterId: lost ? null : st.currentChapterId,
            chapterContent: lost ? null : st.chapterContent,
            history: kept.map((x) => x.h),
            historyIndex: Math.max(-1, kept.filter((x) => x.i <= st.historyIndex).length - 1),
          };
        });
        toast.info(kids.length > 0 ? `卷「${folder.title}」及其中 ${kids.length} 章已移到回收站` : `卷「${folder.title}」已移到回收站`, {
          action: {
            label: "撤销",
            run: async () => {
              await get().restoreChapter(id);
              for (const k of kids) await get().restoreChapter(k);
            },
          },
        });
        return true;
      }
      const idx = before.chapters.findIndex((c) => c.id === id);
      if (idx < 0) return false;
      const title = before.chapters[idx].title;
      try {
        await api.deleteChapter(id);
      } catch (e) {
        toast.error(`删除失败：${errMsg(e)}`);
        return false;
      }
      const rest = before.chapters.filter((c) => c.id !== id);
      const wasCurrent = before.currentChapterId === id;
      set((st) => {
        const panes = { ...st.panes };
        for (const p of ["a", "b"] as PaneId[]) {
          if (panes[p].chapterId === id) panes[p] = { ...EMPTY_PANE };
        }
        // 历史里抹掉它，当前位置按保留下来的条目重算
        const kept = st.history.map((h, i) => ({ h, i })).filter((x) => x.h !== id);
        const historyIndex = kept.filter((x) => x.i <= st.historyIndex).length - 1;
        return {
          chapters: rest,
          panes,
          currentChapterId: st.currentChapterId === id ? null : st.currentChapterId,
          chapterContent: st.currentChapterId === id ? null : st.chapterContent,
          history: kept.map((x) => x.h),
          historyIndex: Math.max(-1, historyIndex),
        };
      });
      if (wasCurrent) {
        const next = rest[idx] ?? rest[idx - 1];
        if (next) await get().selectChapter(next.id);
      }
      toast.info(`「${title}」已移到回收站`, {
        action: { label: "撤销", run: () => get().restoreChapter(id) },
      });
      return true;
    },
    restoreChapter: async (id) => {
      try {
        await trashApi.restoreChapter(id);
      } catch (e) {
        toast.error(`恢复失败：${errMsg(e)}`);
        return;
      }
      await get().reloadChapters();
      if (get().currentChapterId == null && get().chapters.some((c) => c.id === id)) {
        await get().selectChapter(id);
      }
    },
    renameBook: async (id, title) => {
      const t = title.trim();
      const cur = get().books.find((b) => b.id === id);
      if (!cur || t === "" || t === cur.title) return false;
      try {
        const book = await api.renameBook(id, t);
        set((st) => ({ books: st.books.map((b) => (b.id === id ? { ...b, ...book } : b)) }));
        return true;
      } catch (e) {
        toast.error(`重命名失败：${errMsg(e)}`);
        return false;
      }
    },
    deleteBook: async (id) => {
      const book = get().books.find((b) => b.id === id);
      if (!book) return false;
      try {
        await api.deleteBook(id);
      } catch (e) {
        toast.error(`删除失败：${errMsg(e)}`);
        return false;
      }
      if (get().currentBookId === id) {
        set({
          currentBookId: null, currentChapterId: null, chapterContent: null, chapters: [],
          splitAxis: "none", panes: { a: { ...EMPTY_PANE }, b: { ...EMPTY_PANE } },
          activePane: "a", history: [], historyIndex: -1,
        });
      }
      // loadBooks 在无选中书时会自动恢复/选第一本
      await get().loadBooks();
      toast.info(`《${book.title}》已移到书籍回收站`, {
        action: {
          label: "撤销",
          run: async () => {
            try {
              await trashApi.restoreBook(id);
              await get().loadBooks();
              await get().selectBook(id);
            } catch (e) {
              toast.error(`恢复失败：${errMsg(e)}`);
            }
          },
        },
      });
      return true;
    },
    selectChapter: async (id) => {
      set((st) => pushHistory(st, id));
      await loadIntoActive(id);
    },
    setSplitAxis: (axis) => {
      if (axis === "none") {
        // 收分屏：焦点归位 a（b 槽位保留，再次分屏时接着用）
        set((st) => ({
          splitAxis: "none",
          activePane: "a",
          currentChapterId: st.panes.a.chapterId,
          chapterContent: st.panes.a.content,
        }));
        return;
      }
      set({ splitAxis: axis });
    },
    cycleSplit: () => {
      const order: SplitAxis[] = ["none", "vertical", "horizontal"];
      const next = order[(order.indexOf(get().splitAxis) + 1) % order.length];
      get().setSplitAxis(next);
    },
    focusPane: (p) =>
      set((st) =>
        st.activePane === p
          ? {}
          : {
              activePane: p,
              currentChapterId: st.panes[p].chapterId,
              chapterContent: st.panes[p].content,
            },
      ),
    goBack: async () => {
      const { history, historyIndex } = get();
      if (historyIndex <= 0) return;
      set({ historyIndex: historyIndex - 1 });
      await loadIntoActive(history[historyIndex - 1]);
    },
    goForward: async () => {
      const { history, historyIndex } = get();
      if (historyIndex >= history.length - 1) return;
      set({ historyIndex: historyIndex + 1 });
      await loadIntoActive(history[historyIndex + 1]);
    },
    reorderChapters: async (ids) => {
      const bookId = get().currentBookId;
      if (bookId == null) return;
      const prev = get().chapters;
      // 与后端同一「按位置」语义：给定的章依次填回它们占据的位置，继承该位置的 sort_key 与所属卷
      const wanted = new Set(ids);
      const byId = new Map(prev.map((c) => [c.id, c]));
      let k = 0;
      const next = prev.map((slot) => {
        if (!wanted.has(slot.id)) return slot;
        const c = byId.get(ids[k++]);
        return c ? { ...c, sort_key: slot.sort_key, parent_id: slot.parent_id } : slot;
      });
      set({ chapters: next });
      try {
        await api.reorderChapters(ids);
      } catch (e) {
        set({ chapters: prev, error: errMsg(e) });
      }
    },
    reloadChapters: async () => {
      const bookId = get().currentBookId;
      if (bookId == null) return;
      const nodes = await api.listNodes(bookId);
      if (get().currentBookId === bookId) set(splitNodes(nodes));
    },
  };
});
