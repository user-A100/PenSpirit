import {
  Combine,
  Copy,
  ExternalLink,
  FilePlus,
  FileText,
  Focus,
  FolderInput,
  FolderOutput,
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
import { api, type ChapterMeta, type MergeResult } from "./tauri";
import { trashApi } from "./tauri_trash";
import { errMsg } from "./errors";
import { commandShortcut } from "./commands";
import { useUiNav } from "./nav/uiStore";
import { editorsShowing, getActiveEditor } from "./editorBridge";
import { indent, isFolder, kindsOf, moveNodes, nudgeTree, outdent, toItems, treeOrder, type Drop } from "./binderTree";
import { useWorkspace } from "../stores/workspace";
import { useMeta } from "../stores/meta";
import { useBinder } from "../stores/binder";
import { useCollections } from "../stores/collections";
import { useGroupView } from "../stores/groupView";
import { useTemplates } from "../stores/templates";
import { confirmDialog, promptDialog } from "../stores/confirm";
import { toast } from "../stores/toast";
import type { MenuEntry } from "../stores/menu";

// 章节动作（阶段 3A；3B 起含卷）：Binder / 卡片墙 / 大纲列共用同一套右键菜单与批量操作。

const nodeOf = (id: number | null | undefined): ChapterMeta | undefined => {
  if (id == null) return undefined;
  const ws = useWorkspace.getState();
  return ws.chapters.find((c) => c.id === id) ?? ws.volumes.find((v) => v.id === id);
};
export const isVolume = (id: number | null | undefined): boolean => isFolder(nodeOf(id));

/** 当前整棵树（先序清单 + 种类） */
function currentTree() {
  const ws = useWorkspace.getState();
  const nodes = [...ws.volumes, ...ws.chapters];
  return { items: toItems(treeOrder(nodes)), kinds: kindsOf(nodes) };
}

/** 打开单章：活动窗格回到单章模式、侧栏单选它（卷则打开卷首语） */
export async function openChapter(id: number): Promise<void> {
  const ws = useWorkspace.getState();
  useGroupView.getState().setMode(ws.activePane, "single");
  useBinder.getState().selectOne(id);
  const nav = useUiNav.getState();
  if (nav.activeView !== "write") nav.setView("write");
  await ws.selectChapter(id);
}

/** 打开节点：章 = 单章正文；卷 = 选中它，活动窗格切到组视图看卷内各章（Scrivener：选中文件夹看其内容） */
export async function openNode(id: number): Promise<void> {
  if (!isVolume(id)) return openChapter(id);
  useBinder.getState().selectOne(id);
  const nav = useUiNav.getState();
  if (nav.activeView !== "write") nav.setView("write");
  useGroupView.getState().showGroup(useWorkspace.getState().activePane);
}

export async function openInOtherPane(id: number): Promise<void> {
  const ws = useWorkspace.getState();
  if (ws.splitAxis === "none") ws.setSplitAxis("vertical");
  ws.focusPane(ws.activePane === "a" ? "b" : "a");
  await openChapter(id);
}

/**
 * 新建章并进入命名（Scrivener 放置规则）：参照为卷 → 卷末；参照为章 → 其后同级；无参照 → 全书末。
 * 集合作用域下先回到整本书（新章不在集合里，否则看不到命名框）。可带模板正文。
 */
export async function newChapterAfter(refId: number | null, templateContent?: string): Promise<void> {
  const ws = useWorkspace.getState();
  if (useBinder.getState().scope.kind !== "book") useBinder.getState().setScope({ kind: "book" });
  const created = await ws.createChapter(
    "新章节",
    isVolume(refId) ? { parentId: refId, select: true } : { afterId: refId, select: true },
  );
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

/** 新建卷并进入命名（阶段 3B）：childIds 非空 = 把这些章放入新卷（新卷占第一章的位置） */
export async function newVolume(afterId: number | null, childIds: number[] = []): Promise<void> {
  if (useBinder.getState().scope.kind !== "book") useBinder.getState().setScope({ kind: "book" });
  const texts = childIds.filter((id) => !isVolume(id));
  const folder = await useWorkspace.getState().createVolume("新卷", { afterId, childIds: texts });
  if (!folder) return;
  useBinder.getState().selectOne(folder.id);
  useBinder.getState().startRename({ kind: "chapter", id: folder.id });
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

/** 批量设标签 / 状态（null = 清除）；章与卷都适用 */
export async function setChaptersMeta(ids: number[], update: { label_id?: number | null; status_id?: number | null }): Promise<void> {
  try {
    const metas = await Promise.all(ids.map((id) => api.chapterUpdateMeta(id, update)));
    useWorkspace.getState().patchNodes(metas);
  } catch (e) {
    toast.error(errMsg(e));
  }
}

/** 删除：单章直接进回收站（Toast 可撤销）；多项或含非空卷先确认。选中卷时卷内的章随卷处理 */
export async function deleteChapters(ids: number[]): Promise<void> {
  const ws = useWorkspace.getState();
  const folders = ids.filter(isVolume);
  // 父卷也在选区里的章由卷级联处理
  const targets = ids.filter((id) => !folders.includes(nodeOf(id)?.parent_id ?? -1));
  const kids = ws.chapters.filter((c) => c.parent_id != null && folders.includes(c.parent_id)).length;
  if (targets.length > 1 || kids > 0) {
    const ok = await confirmDialog({
      title: folders.length > 0 ? `把选中的 ${targets.length} 项移到回收站？` : `把选中的 ${targets.length} 章移到回收站？`,
      message: kids > 0 ? `卷内的 ${kids} 章一并移到回收站，都可从回收站恢复。` : "可在回收站里逐章恢复。",
      confirmLabel: "移到回收站",
      danger: true,
    });
    if (!ok) return;
  }
  for (const id of targets) await ws.deleteChapter(id);
  useBinder.getState().clearSelection();
}

/** 可合并：两章以上、都是正文章、同一卷内、全书先序相邻 */
export function canMerge(ids: number[]): boolean {
  if (ids.length < 2 || ids.some(isVolume)) return false;
  const { items } = currentTree();
  const pos = ids.map((id) => items.findIndex((x) => x.id === id)).sort((a, b) => a - b);
  if (pos[0] < 0) return false;
  const parent = items[pos[0]].parent_id;
  return pos.every((p, i) => (i === 0 || p === pos[i - 1] + 1) && items[p].parent_id === parent);
}

/** 合并为一章（阶段 3B）：并入全书序靠前的那章，其余进回收站；Toast 一步撤销 */
export async function mergeChapters(ids: number[]): Promise<void> {
  if (!canMerge(ids)) {
    toast.info("只能合并同一卷内相邻的章");
    return;
  }
  // 防抖窗口内的改动先落盘，合并读到的才是最新正文
  for (const ed of editorsShowing(ids)) await ed.flush?.();
  let r: MergeResult;
  try {
    r = await api.chapterMerge(ids);
  } catch (e) {
    toast.error(`合并失败：${errMsg(e)}`);
    return;
  }
  const ws = useWorkspace.getState();
  await ws.reloadChapters();
  const merged = (await api.readChapter(r.merged.id)).content;
  for (const ed of editorsShowing([r.merged.id])) ed.resetContent?.(merged);
  if (r.removed.includes(useWorkspace.getState().currentChapterId ?? -1)) await openChapter(r.merged.id);
  useBinder.getState().selectOne(r.merged.id);
  toast.success(`已把 ${ids.length} 章合并为「${r.merged.title}」`, {
    action: {
      label: "撤销",
      run: async () => {
        await api.writeChapter(r.merged.id, r.original);
        for (const id of r.removed) await trashApi.restoreChapter(id);
        await useWorkspace.getState().reloadChapters();
        for (const ed of editorsShowing([r.merged.id])) ed.resetContent?.(r.original);
      },
    },
  });
}

/** 在光标处拆分当前章（阶段 3B）：后半成为紧随其后的同卷新章；Toast 一步撤销 */
export async function splitCurrentChapter(): Promise<void> {
  const ed = getActiveEditor();
  const ch = useWorkspace.getState().chapters.find((c) => c.id === ed?.chapterId);
  if (!ed || !ch) {
    toast.info("先在正文里把光标放到要拆开的位置");
    return;
  }
  const parts = ed.splitAtCursor?.();
  if (!parts) {
    toast.info("光标在章首或章末，无需拆分");
    return;
  }
  const full = ed.markdown?.() ?? "";
  const title = await promptDialog({
    title: "在光标处拆分",
    message: "光标之后的内容会成为紧随其后的新章（同卷）；拆分前的全文会留一版历史快照。",
    initial: `${ch.title}（续）`,
    confirmLabel: "拆分",
  });
  if (!title) return;
  let created: ChapterMeta;
  try {
    created = await api.chapterSplit(ch.id, parts.head, parts.tail, title);
  } catch (e) {
    toast.error(`拆分失败：${errMsg(e)}`);
    return;
  }
  for (const e of editorsShowing([ch.id])) e.resetContent?.(parts.head);
  await useWorkspace.getState().reloadChapters();
  toast.success(`已拆出「${created.title}」`, {
    action: {
      label: "撤销",
      run: async () => {
        await api.writeChapter(ch.id, full);
        await api.deleteChapter(created.id);
        await trashApi.purgeChapter(created.id);
        await useWorkspace.getState().reloadChapters();
        for (const e of editorsShowing([ch.id])) e.resetContent?.(full);
      },
    },
  });
}

/** 树操作（阶段 3B）：拖放落点 / 降级（并入上一卷）/ 升级（移出卷）/ 同级移位，统一走 applyTree */
export async function moveTree(ids: number[], drop: Drop): Promise<boolean> {
  const { items, kinds } = currentTree();
  const next = moveNodes(items, kinds, ids, drop);
  return next ? useWorkspace.getState().applyTree(next) : false;
}
export async function indentNodes(ids: number[]): Promise<boolean> {
  const { items, kinds } = currentTree();
  const next = indent(items, kinds, ids);
  return next ? useWorkspace.getState().applyTree(next) : false;
}
export async function outdentNodes(ids: number[]): Promise<boolean> {
  const { items, kinds } = currentTree();
  const next = outdent(items, kinds, ids);
  return next ? useWorkspace.getState().applyTree(next) : false;
}
export async function nudgeNodes(ids: number[], dir: -1 | 1): Promise<boolean> {
  const { items, kinds } = currentTree();
  const next = nudgeTree(items, kinds, ids, dir);
  return next ? useWorkspace.getState().applyTree(next) : false;
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

function metaSubmenus(ids: number[], single: boolean, node: ChapterMeta | undefined): MenuEntry[] {
  const meta = useMeta.getState();
  return [
    {
      label: single ? "标签" : `标签（${ids.length} 项）`,
      icon: Tag,
      submenu: [
        ...meta.labels.map((l) => ({
          label: l.title,
          swatch: l.color,
          checked: single && node?.label_id === l.id,
          onSelect: () => void setChaptersMeta(ids, { label_id: l.id }),
        })),
        { type: "separator" as const },
        { label: "清除标签", onSelect: () => void setChaptersMeta(ids, { label_id: null }) },
      ],
    },
    {
      label: single ? "状态" : `状态（${ids.length} 项）`,
      icon: CircleDot,
      submenu: [
        ...meta.statuses.map((st) => ({
          label: st.title,
          checked: single && node?.status_id === st.id,
          onSelect: () => void setChaptersMeta(ids, { status_id: st.id }),
        })),
        { type: "separator" as const },
        { label: "清除状态", onSelect: () => void setChaptersMeta(ids, { status_id: null }) },
      ],
    },
  ];
}

/** 卷的右键菜单（阶段 3B） */
function volumeMenu(id: number): MenuEntry[] {
  const node = nodeOf(id);
  return [
    { label: "打开卷首语", icon: FileText, onSelect: () => void openChapter(id) },
    { label: "聚焦此卷", icon: Focus, onSelect: () => useBinder.getState().setHoist(id) },
    { type: "separator" },
    { label: "在卷内新建章节", icon: FilePlus, shortcut: commandShortcut("chapter.new"), onSelect: () => void newChapterAfter(id) },
    { label: "在此后新建卷", icon: FolderPlus, shortcut: commandShortcut("volume.new"), onSelect: () => void newVolume(id) },
    { label: "重命名", icon: Pencil, shortcut: "F2", onSelect: () => useBinder.getState().startRename({ kind: "chapter", id }) },
    { type: "separator" },
    ...metaSubmenus([id], true, node),
    { type: "separator" },
    { label: "删除卷…", icon: Trash2, shortcut: "Del", danger: true, onSelect: () => void deleteChapters([id]) },
  ];
}

/**
 * 章节右键菜单：ids = 作用对象（右键在选区内 → 整个选区；否则只它）。
 * inCollection 给出时追加「移出集合」（手动集合）。单选卷时给卷的菜单。
 */
export function chapterMenu(ids: number[], opts: { inCollection?: { id: number; kind: string } | null } = {}): MenuEntry[] {
  const ws = useWorkspace.getState();
  const first = ids[0];
  const single = ids.length === 1;
  if (single && isVolume(first)) return volumeMenu(first);
  const node = nodeOf(first);
  const texts = ids.filter((id) => !isVolume(id));
  const templates = useTemplates.getState().list;
  const manualCols = useCollections.getState().list.filter((c) => c.kind === "manual");
  const tree = currentTree();
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
      label: `以卡片墙查看这 ${ids.length} 项`,
      icon: LayoutGrid,
      onSelect: () => {
        useBinder.getState().setSelection(ids, ids);
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
  // 结构（阶段 3B）
  if (texts.length > 0) {
    items.push({ type: "separator" });
    items.push({ label: texts.length > 1 ? `放入新卷（${texts.length} 章）` : "放入新卷", icon: FolderPlus, onSelect: () => void newVolume(null, texts) });
    if (indent(tree.items, tree.kinds, texts)) items.push({ label: "并入上一卷", icon: FolderInput, shortcut: "Ctrl+→", onSelect: () => void indentNodes(texts) });
    if (outdent(tree.items, tree.kinds, texts)) items.push({ label: "移出所在卷", icon: FolderOutput, shortcut: "Ctrl+←", onSelect: () => void outdentNodes(texts) });
    if (canMerge(ids)) items.push({ label: `合并为一章（${ids.length} 章）`, icon: Combine, onSelect: () => void mergeChapters(ids) });
  }
  items.push({ type: "separator" });
  items.push(...metaSubmenus(ids, single, node));
  if (texts.length > 0) {
    items.push({
      label: "加入集合",
      icon: Library,
      submenu: [
        ...manualCols.map((c) => ({ label: c.name, onSelect: () => void useCollections.getState().addChapters(c.id, texts) })),
        ...(manualCols.length > 0 ? [{ type: "separator" as const }] : []),
        { label: "新建集合…", icon: FolderPlus, onSelect: () => void newCollection(texts) },
      ],
    });
  }
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
    label: single ? "移到回收站" : `把 ${ids.length} 项移到回收站…`,
    icon: Trash2,
    shortcut: "Del",
    danger: true,
    onSelect: () => void deleteChapters(ids),
  });
  return items;
}
