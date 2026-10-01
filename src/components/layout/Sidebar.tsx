import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  BookPlus,
  ChevronsUpDown,
  FileDown,
  FilePlus,
  FileText,
  FileUp,
  PanelLeftClose,
  Pencil,
  Plus,
  RotateCcw,
  SquareSplitHorizontal,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useBinder } from "../../stores/binder";
import { openContextMenu, openMenuAt, type MenuEntry } from "../../stores/menu";
import { confirmDialog, promptDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { TrashPanel } from "../sidebar/TrashPanel";
import { StatsBadge } from "../sidebar/StatsBadge";
import { ImportWizard } from "../io/ImportWizard";
import { ExportDialog } from "../io/ExportDialog";
import { useUiNav } from "../../lib/nav/uiStore";
import { commandShortcut } from "../../lib/commands";
import { errMsg } from "../../lib/errors";
import { api, type Book, type ChapterMeta } from "../../lib/tauri";

// 侧栏（阶段 1 Zen 化）：贴在背板上、无描边。
// 顶部「书切换器」（Zen 工作区手法：一本书 = 一个工作区，下拉切换/新建/管理）；
// 章节行选中态 = 一小片稿纸（卡片色 + 极薄阴影），行内操作 hover 才出现。
// 结构交互（多选/键盘导航/拖放重写/过滤/层级）在阶段 3A/3B 接续。

const ROW =
  "group/row relative flex h-8 cursor-pointer select-none items-center gap-2 rounded-[var(--r-control)] px-2 outline-none transition-[background-color,color,box-shadow,transform] duration-[var(--dur-md)] active:scale-[0.985] focus-visible:[box-shadow:var(--focus-ring)]";
const ROW_IDLE = "text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";
const ROW_ACTIVE = "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]";
const ICON_BTN =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-control)] text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";

/** 行内改名输入框：Enter 提交、Esc 取消、失焦提交；挂载即全选 */
function RenameInput({ initial, onCommit, onCancel }: { initial: string; onCommit: (v: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label="新名称"
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="h-6 min-w-0 flex-1 rounded-[4px] border border-[color:var(--accent)] bg-[var(--bg-panel)] px-1.5 text-sm text-[color:var(--text-primary)] outline-none"
    />
  );
}

export function Sidebar() {
  const books = useWorkspace((s) => s.books);
  const chapters = useWorkspace((s) => s.chapters);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const { loadBooks, selectBook, createBook, createChapter, selectChapter, reloadChapters, reorderChapters } = useWorkspace.getState();
  const renameChapter = useWorkspace((s) => s.renameChapter);
  const deleteChapter = useWorkspace((s) => s.deleteChapter);
  const renameBook = useWorkspace((s) => s.renameBook);
  const deleteBook = useWorkspace((s) => s.deleteBook);
  const labels = useMeta((s) => s.labels);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const renaming = useBinder((s) => s.renaming);
  const startRename = useBinder((s) => s.startRename);
  const stopRename = useBinder((s) => s.stopRename);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const book = books.find((b) => b.id === currentBookId) ?? null;

  const newChapterAfter = async (afterId: number | null) => {
    const created = await createChapter("新章节", { afterId, select: true });
    if (created) startRename({ kind: "chapter", id: created.id });
  };

  const newBook = async () => {
    const title = await promptDialog({ title: "新建书", placeholder: "书名", confirmLabel: "创建" });
    if (!title) return;
    try {
      await createBook(title);
    } catch (e) {
      toast.error(`新建失败：${errMsg(e)}`);
    }
  };

  const rescan = async () => {
    try {
      const n = await api.rescanLibrary();
      await loadBooks();
      await reloadChapters();
      toast.success(`已从磁盘重建索引，共 ${n} 章`);
    } catch (e) {
      toast.error(`重建索引失败：${errMsg(e)}`);
    }
  };

  const askDeleteBook = async (b: Book) => {
    const ok = await confirmDialog({
      title: `删除《${b.title}》？`,
      message: "整本书会移到书籍回收站（可从回收站或稍后弹出的提示里撤销）。",
      confirmLabel: "移到回收站",
      danger: true,
    });
    if (ok) await deleteBook(b.id);
  };

  const bookMenu = (): MenuEntry[] => {
    const items: MenuEntry[] = [];
    if (books.length > 0) {
      items.push({ type: "label", label: "切换书" });
      for (const b of books) {
        items.push({ label: b.title, icon: BookOpen, checked: b.id === currentBookId, onSelect: () => void selectBook(b.id) });
      }
      items.push({ type: "separator" });
    }
    items.push({ label: "新建书…", icon: BookPlus, onSelect: () => void newBook() });
    items.push({ label: "导入章节…", icon: FileUp, onSelect: () => setImportOpen(true) });
    if (book) {
      items.push({ label: "导出全书…", icon: FileDown, onSelect: () => setExportOpen(true) });
      items.push({ type: "separator" });
      items.push({ label: "重命名本书", icon: Pencil, onSelect: () => startRename({ kind: "book", id: book.id }) });
      items.push({ label: "从磁盘重建索引", icon: RotateCcw, onSelect: () => void rescan() });
      items.push({ type: "separator" });
      items.push({ label: "删除这本书…", icon: Trash2, danger: true, onSelect: () => void askDeleteBook(book) });
    }
    return items;
  };

  const chapterMenu = (c: ChapterMeta): MenuEntry[] => [
    { label: "打开", icon: FileText, onSelect: () => void selectChapter(c.id) },
    {
      label: "在另一窗格打开",
      icon: SquareSplitHorizontal,
      onSelect: () => {
        const ws = useWorkspace.getState();
        if (ws.splitAxis === "none") ws.setSplitAxis("vertical");
        ws.focusPane(ws.activePane === "a" ? "b" : "a");
        void ws.selectChapter(c.id);
      },
    },
    { type: "separator" },
    { label: "在此后新建章节", icon: FilePlus, shortcut: commandShortcut("chapter.new"), onSelect: () => void newChapterAfter(c.id) },
    { label: "重命名", icon: Pencil, shortcut: "F2", onSelect: () => startRename({ kind: "chapter", id: c.id }) },
    { type: "separator" },
    { label: "移到回收站", icon: Trash2, shortcut: "Del", danger: true, onSelect: () => void deleteChapter(c.id) },
  ];

  const renamingBook = book != null && renaming?.kind === "book" && renaming.id === book.id;

  return (
    <div className="flex h-full flex-col bg-transparent pl-1 text-sm">
      {/* 顶部：书切换器 + 折叠 */}
      <div className="group flex h-12 shrink-0 items-center gap-1 pr-1">
        {renamingBook ? (
          <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
            <BookOpen size={15} className="shrink-0 text-[color:var(--accent)]" />
            <RenameInput
              initial={book.title}
              onCommit={(v) => {
                stopRename();
                void renameBook(book.id, v);
              }}
              onCancel={stopRename}
            />
          </div>
        ) : (
          <button
            data-book-switcher=""
            aria-label="切换或管理书"
            aria-haspopup="menu"
            onClick={(e) => openMenuAt(e.currentTarget, bookMenu())}
            onDoubleClick={() => book && startRename({ kind: "book", id: book.id })}
            onContextMenu={(e) => openContextMenu(e, bookMenu())}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-[var(--r-control)] px-2 py-1.5 text-left transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)]"
          >
            <BookOpen size={15} className="shrink-0 text-[color:var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-md font-semibold text-[color:var(--text-primary)]">
              {book?.title ?? "选择或新建一本书"}
            </span>
            <ChevronsUpDown size={13} className="shrink-0 text-[color:var(--text-faint)]" />
          </button>
        )}
        <button
          onClick={toggleSidebar}
          aria-label="折叠侧栏"
          data-tip="折叠侧栏"
          data-tip-key={commandShortcut("view.toggleSidebar")}
          className={`${ICON_BTN} opacity-0 focus-visible:opacity-100 group-hover:opacity-100`}
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {books.length === 0 ? (
        /* 空库：引导新建或导入 */
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
          <BookOpen size={28} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
          <div className="text-ui text-[color:var(--text-secondary)]">还没有书</div>
          <div className="flex gap-2">
            <button onClick={() => void newBook()} className="rounded-[var(--r-control)] bg-[var(--accent)] px-3 py-1.5 text-ui font-medium text-white transition-[filter] hover:brightness-110">
              新建书
            </button>
            <button onClick={() => setImportOpen(true)} aria-label="导入章节" className="rounded-[var(--r-control)] px-3 py-1.5 text-ui text-[color:var(--text-secondary)] transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]">
              导入文本
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 分区头：章节数 + 新建 */}
          <div className="flex h-7 shrink-0 items-center gap-1 pl-2 pr-1">
            <span className="flex-1 text-2xs font-medium tracking-wide text-[color:var(--text-faint)]">
              章节{chapters.length > 0 && <span className="ml-1 tabular-nums">{chapters.length}</span>}
            </span>
            {book && (
              <button
                onClick={() => void newChapterAfter(currentChapterId)}
                aria-label="新建章节"
                data-tip="在当前章之后新建"
                data-tip-key={commandShortcut("chapter.new")}
                className={ICON_BTN}
              >
                <Plus size={15} />
              </button>
            )}
          </div>

          {/* 章节列表 */}
          <div className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1" role="list" aria-label="章节">
            {book && chapters.length === 0 && (
              <div className="mt-6 flex flex-col items-center gap-2 px-4 text-center">
                <div className="text-ui text-[color:var(--text-faint)]">这本书还没有章节</div>
                <button
                  onClick={() => void newChapterAfter(null)}
                  className="rounded-[var(--r-control)] px-3 py-1.5 text-ui text-[color:var(--accent)] transition-colors hover:bg-[var(--fill-hover)]"
                >
                  新建第一章
                </button>
              </div>
            )}
            <div className="flex flex-col gap-px">
              {chapters.map((c) => {
                const active = currentChapterId === c.id;
                // Scrivener 式标签色：章打了标签时图标染标签色
                const label = labels.find((l) => l.id === c.label_id) ?? null;
                const editing = renaming?.kind === "chapter" && renaming.id === c.id;
                return (
                  <div
                    key={c.id}
                    role="listitem"
                    tabIndex={0}
                    data-chapter-row={c.id}
                    aria-current={active ? "true" : undefined}
                    draggable={!editing}
                    onDragStart={() => setDragId(c.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragId != null && dragId !== c.id) {
                        const ids = chapters.map((x) => x.id);
                        const from = ids.indexOf(dragId);
                        const to = ids.indexOf(c.id);
                        if (from >= 0 && to >= 0) {
                          ids.splice(to, 0, ids.splice(from, 1)[0]);
                          void reorderChapters(ids);
                        }
                      }
                      setDragId(null);
                    }}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => void selectChapter(c.id)}
                    onDoubleClick={() => startRename({ kind: "chapter", id: c.id })}
                    onContextMenu={(e) => openContextMenu(e, chapterMenu(c))}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "F2") {
                        e.preventDefault();
                        startRename({ kind: "chapter", id: c.id });
                      } else if (e.key === "Delete") {
                        e.preventDefault();
                        void deleteChapter(c.id);
                      } else if (e.key === "Enter") {
                        void selectChapter(c.id);
                      }
                    }}
                    className={`${ROW} ${active ? ROW_ACTIVE : ROW_IDLE} ${dragId === c.id ? "opacity-40" : ""}`}
                  >
                    <FileText
                      size={14}
                      strokeWidth={1.75}
                      className={`shrink-0 ${label ? "" : active ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"}`}
                      style={label ? { color: label.color } : undefined}
                    />
                    {editing ? (
                      <RenameInput
                        initial={c.title}
                        onCommit={(v) => {
                          stopRename();
                          void renameChapter(c.id, v);
                        }}
                        onCancel={stopRename}
                      />
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className="shrink-0 text-2xs tabular-nums text-[color:var(--text-faint)]">
                          {c.word_count > 0 ? c.word_count.toLocaleString() : ""}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* 底部：回收站 + 今日字数 */}
      <div className="relative flex h-10 shrink-0 items-center gap-1 pl-1 pr-1">
        <button
          data-trash-toggle
          onClick={() => setTrashOpen((v) => !v)}
          aria-label="回收站"
          data-tip="回收站"
          className={ICON_BTN}
        >
          <Trash2 size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <StatsBadge />
        </div>
        {trashOpen && <TrashPanel bookId={currentBookId} placement="above" onClose={() => setTrashOpen(false)} />}
      </div>

      {importOpen && (
        <ImportWizard
          bookId={currentBookId}
          onClose={() => setImportOpen(false)}
          onImported={(bid) => {
            if (bid === currentBookId) {
              void reloadChapters();
            } else {
              // 向导自动建的新书：刷书单并选中（selectBook 会连带拉章节）
              void loadBooks().then(() => selectBook(bid));
            }
          }}
        />
      )}
      {exportOpen && currentBookId != null && (
        <ExportDialog
          bookId={currentBookId}
          bookTitle={book?.title ?? "导出"}
          chapters={chapters}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
