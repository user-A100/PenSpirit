import { useEffect, useState } from "react";
import { BookOpen, BookPlus, ChevronsUpDown, FileDown, FileUp, FolderPlus, PanelLeftClose, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useBinder } from "../../stores/binder";
import { openContextMenu, openMenuAt, type MenuEntry } from "../../stores/menu";
import { confirmDialog, promptDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { TrashPanel } from "../sidebar/TrashPanel";
import { StatsBadge } from "../sidebar/StatsBadge";
import { ImportWizard } from "../io/ImportWizard";
import { ExportDialog } from "../io/ExportDialog";
import { Binder } from "../binder/Binder";
import { RenameInput } from "../binder/RenameInput";
import { useUiNav } from "../../lib/nav/uiStore";
import { commandShortcut } from "../../lib/commands";
import { newCollection } from "../../lib/binderActions";
import { errMsg } from "../../lib/errors";
import { api, type Book } from "../../lib/tauri";

// 侧栏（阶段 1 Zen 化）：贴在背板上、无描边。
// 顶部「书切换器」（Zen 工作区手法：一本书 = 一个工作区，下拉切换/新建/管理）；
// 中部是 Binder（阶段 3A：多选 / 键盘 / 拖放 / 过滤 / 集合标签页，见 binder/Binder.tsx）；
// 底部回收站 + 今日字数。

const ICON_BTN =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-[var(--r-control)] text-[color:var(--text-faint)] transition-colors duration-[var(--dur-md)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]";

export function Sidebar() {
  const books = useWorkspace((s) => s.books);
  const chapters = useWorkspace((s) => s.chapters);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const { loadBooks, selectBook, createBook, reloadChapters } = useWorkspace.getState();
  const renameBook = useWorkspace((s) => s.renameBook);
  const deleteBook = useWorkspace((s) => s.deleteBook);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const renaming = useBinder((s) => s.renaming);
  const startRename = useBinder((s) => s.startRename);
  const stopRename = useBinder((s) => s.stopRename);
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const book = books.find((b) => b.id === currentBookId) ?? null;

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
      items.push({ label: "新建集合…", icon: FolderPlus, onSelect: () => void newCollection([], true) });
      items.push({ type: "separator" });
      items.push({ label: "重命名本书", icon: Pencil, onSelect: () => startRename({ kind: "book", id: book.id }) });
      items.push({ label: "从磁盘重建索引", icon: RotateCcw, onSelect: () => void rescan() });
      items.push({ type: "separator" });
      items.push({ label: "删除这本书…", icon: Trash2, danger: true, onSelect: () => void askDeleteBook(book) });
    }
    return items;
  };

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
        <Binder />
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
