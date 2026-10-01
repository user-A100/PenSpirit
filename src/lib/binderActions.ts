import {
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
  FolderPlus,
  LayoutGrid,
  ListMinus,
  Pencil,
  SquareSplitHorizontal,
  Tag,
  CircleDot,
  Trash2,
  Library,
} from "lucide-react";
import { api, type ChapterMeta } from "./tauri";
import { errMsg } from "./errors";
import { commandShortcut } from "./commands";
import { useUiNav } from "./nav/uiStore";
import { useWorkspace } from "../stores/workspace";
import { useMeta } from "../stores/meta";
import { useBinder } from "../stores/binder";
import { useCollections } from "../stores/collections";
import { useGroupView } from "../stores/groupView";
import { useTemplates } from "../stores/templates";
import { confirmDialog, promptDialog } from "../stores/confirm";
import { toast } from "../stores/toast";
import type { MenuEntry } from "../stores/menu";

// 章节动作（阶段 3A）：Binder / 卡片墙 / 大纲列共用同一套右键菜单与批量操作。

/** 打开单章：活动窗格回到单章模式、侧栏单选它 */
export async function openChapter(id: number): Promise<void> {
  const ws = useWorkspace.getState();
  useGroupView.getState().setMode(ws.activePane, "single");
  useBinder.getState().selectOne(id);
  const nav = useUiNav.getState();
  if (nav.activeView !== "write") nav.setView("write");
  await ws.selectChapter(id);
}

export async function openInOtherPane(id: number): Promise<void> {
  const ws = useWorkspace.getState();
  if (ws.splitAxis === "none") ws.setSplitAxis("vertical");
  ws.focusPane(ws.activePane === "a" ? "b" : "a");
  await openChapter(id);
}

/** 在某章之后新建并进入命名；可带模板正文。集合作用域下先回到整本书（新章不在集合里，否则看不到命名框） */
export async function newChapterAfter(afterId: number | null, templateContent?: string): Promise<void> {
  const ws = useWorkspace.getState();
  if (useBinder.getState().scope.kind !== "book") useBinder.getState().setScope({ kind: "book" });
  const created = await ws.createChapter("新章节", { afterId, select: true });
  if (!created) return;
  if (templateContent) {
    try {
      await api.writeChapter(created.id, templateContent);
      await useWorkspace.getState().selectChapter(created.id);
    } catch (e) {
      toast.error(`模板写入失败：${errMsg(e)}`);
    }
  }
  useBinder.getState().selectOne(created.id);
  useBinder.getState().startRename({ kind: "chapter", id: created.id });
}

/** 复制一章（正文 + 梗概/标签/状态/目标），副本紧跟原章 */
export async function duplicateChapter(id: number): Promise<void> {
  const ws = useWorkspace.getState();
  const src = ws.chapters.find((c) => c.id === id);
  if (!src) return;
  try {
    const content = (await api.readChapter(id)).content;
    const created = await ws.createChapter(`${src.title}（副本）`, { afterId: id });
    if (!created) return;
    await api.writeChapter(created.id, content);
    await api.chapterUpdateMeta(created.id, {
      synopsis: src.synopsis,
      label_id: src.label_id,
      status_id: src.status_id,
      target_words: src.target_words,
    });
    await ws.reloadChapters();
    toast.success(`已复制「${src.title}」`);
  } catch (e) {
    toast.error(`复制失败：${errMsg(e)}`);
  }
}

/** 批量设标签 / 状态（null = 清除） */
export async function setChaptersMeta(ids: number[], update: { label_id?: number | null; status_id?: number | null }): Promise<void> {
  try {
    const metas = await Promise.all(ids.map((id) => api.chapterUpdateMeta(id, update)));
    const byId = new Map(metas.map((m) => [m.id, m]));
    useWorkspace.setState((s) => ({ chapters: s.chapters.map((c) => (byId.has(c.id) ? { ...c, ...byId.get(c.id)! } : c)) }));
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** 删除：单章直接进回收站（Toast 可撤销）；多章先确认 */
export async function deleteChapters(ids: number[]): Promise<void> {
  const ws = useWorkspace.getState();
  if (ids.length > 1) {
    const ok = await confirmDialog({
      title: `把选中的 ${ids.length} 章移到回收站？`,
      message: "可在回收站里逐章恢复。",
      confirmLabel: "移到回收站",
      danger: true,
    });
    if (!ok) return;
    for (const id of ids) await ws.deleteChapter(id);
  } else if (ids.length === 1) {
    await ws.deleteChapter(ids[0]);
  }
  useBinder.getState().clearSelection();
}

/** 新建手动集合（可顺带加入章节）；open = 建好后把 Binder 切到该集合 */
export async function newCollection(ids: number[] = [], open = false): Promise<void> {
  const name = await promptDialog({
    title: "新建集合",
    placeholder: "集合名，如：反派线、待修改",
    confirmLabel: ids.length > 0 ? "创建并加入" : "创建",
  });
  if (!name) return;
  const c = await useCollections.getState().create(name);
  if (!c) return;
  if (ids.length > 0) await useCollections.getState().addChapters(c.id, ids);
  if (open) useBinder.getState().setScope({ kind: "collection", id: c.id, name: c.name, collectionKind: c.kind, query: c.query });
}

/**
 * 章节右键菜单：ids = 作用对象（右键在选区内 → 整个选区；否则只它）。
 * inCollection 给出时追加「移出集合」（手动集合）。
 */
export function chapterMenu(ids: number[], opts: { inCollection?: { id: number; kind: string } | null } = {}): MenuEntry[] {
  const ws = useWorkspace.getState();
  const meta = useMeta.getState();
  const first = ids[0];
  const single = ids.length === 1;
  const ch: ChapterMeta | undefined = ws.chapters.find((c) => c.id === first);
  const templates = useTemplates.getState().list;
  const manualCols = useCollections.getState().list.filter((c) => c.kind === "manual");
  const items: MenuEntry[] = [];
  if (single) {
    items.push({ label: "打开", icon: FileText, onSelect: () => void openChapter(first) });
    items.push({ label: "在另一窗格打开", icon: SquareSplitHorizontal, onSelect: () => void openInOtherPane(first) });
    items.push({
      label: "在参考浮窗中打开",
      icon: ExternalLink,
      onSelect: () => {
        if (ws.currentBookId != null) void api.openRefWindow(ws.currentBookId, first).catch((e) => toast.error(errMsg(e)));
      },
    });
  } else {
    items.push({
      label: `以卡片墙查看这 ${ids.length} 章`,
      icon: LayoutGrid,
      onSelect: () => {
        useBinder.getState().setSelection(ids, ws.chapters.map((c) => c.id));
        useGroupView.getState().setMode(ws.activePane, "corkboard");
      },
    });
  }
  items.push({ type: "separator" });
  items.push({ label: "在此后新建章节", icon: FilePlus, shortcut: commandShortcut("chapter.new"), onSelect: () => void newChapterAfter(ids[ids.length - 1]) });
  if (templates.length > 0) {
    items.push({
      label: "从模板新建",
      icon: FilePlus,
      submenu: templates.map((t) => ({ label: t.name, onSelect: () => void newChapterAfter(ids[ids.length - 1], t.content) })),
    });
  }
  if (single) {
    items.push({ label: "重命名", icon: Pencil, shortcut: "F2", onSelect: () => useBinder.getState().startRename({ kind: "chapter", id: first }) });
    items.push({ label: "复制一份", icon: Copy, onSelect: () => void duplicateChapter(first) });
  }
  items.push({ type: "separator" });
  items.push({
    label: single ? "标签" : `标签（${ids.length} 章）`,
    icon: Tag,
    submenu: [
      ...meta.labels.map((l) => ({
        label: l.title,
        swatch: l.color,
        checked: single && ch?.label_id === l.id,
        onSelect: () => void setChaptersMeta(ids, { label_id: l.id }),
      })),
      { type: "separator" as const },
      { label: "清除标签", onSelect: () => void setChaptersMeta(ids, { label_id: null }) },
    ],
  });
  items.push({
    label: single ? "状态" : `状态（${ids.length} 章）`,
    icon: CircleDot,
    submenu: [
      ...meta.statuses.map((st) => ({
        label: st.title,
        checked: single && ch?.status_id === st.id,
        onSelect: () => void setChaptersMeta(ids, { status_id: st.id }),
      })),
      { type: "separator" as const },
      { label: "清除状态", onSelect: () => void setChaptersMeta(ids, { status_id: null }) },
    ],
  });
  items.push({
    label: "加入集合",
    icon: Library,
    submenu: [
      ...manualCols.map((c) => ({ label: c.name, onSelect: () => void useCollections.getState().addChapters(c.id, ids) })),
      ...(manualCols.length > 0 ? [{ type: "separator" as const }] : []),
      { label: "新建集合…", icon: FolderPlus, onSelect: () => void newCollection(ids) },
    ],
  });
  if (opts.inCollection && opts.inCollection.kind === "manual") {
    const colId = opts.inCollection.id;
    items.push({
      label: single ? "移出集合" : `移出集合（${ids.length} 章）`,
      icon: ListMinus,
      onSelect: async () => {
        for (const id of ids) await useCollections.getState().removeChapter(colId, id);
      },
    });
  }
  items.push({ type: "separator" });
  items.push({
    label: single ? "移到回收站" : `把 ${ids.length} 章移到回收站…`,
    icon: Trash2,
    shortcut: "Del",
    danger: true,
    onSelect: () => void deleteChapters(ids),
  });
  return items;
}
