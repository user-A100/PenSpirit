import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  FileDown,
  FilePlus,
  FileText,
  FileUp,
  FolderOpen,
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
import { openContextMenu, type MenuEntry } from "../../stores/menu";
import { confirmDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { TrashPanel } from "../sidebar/TrashPanel";
import { StatsBadge } from "../sidebar/StatsBadge";
import { ImportWizard } from "../io/ImportWizard";
import { ExportDialog } from "../io/ExportDialog";
import { useUiNav } from "../../lib/nav/uiStore";
import { commandShortcut } from "../../lib/commands";
import { errMsg } from "../../lib/errors";
import { api, type Book, type ChapterMeta } from "../../lib/tauri";

// 列表行选中态：accent-dim 底 + 左侧 2px accent 竖条（无动画跳变，仅颜色过渡）
function rowTone(active: boolean): string {
  return active
    ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]"
    : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]";
}

function ActiveBar() {
  return (
    <span
      aria-hidden
      className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-[color:var(--accent)]"
    />
  );
}

// 内联「新建」输入行：bg-elevated 圆角，focus 时 border-accent
function InlineInput(props: {
  value: string;
  placeholder: string;
  title: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-1.5 flex items-center gap-1 rounded-md border border-transparent bg-[var(--bg-elevated)] px-2 py-1 transition-colors duration-150 focus-within:border-[color:var(--accent)]">
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) props.onSubmit();
        }}
        placeholder={props.placeholder}
        className="min-w-0 flex-1 bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
      />
      <button
        onClick={props.onSubmit}
        title={props.title}
        className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}

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
      className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[color:var(--accent)] bg-[var(--bg-elevated)] px-1.5 py-0 text-sm text-[color:var(--text-primary)] outline-none"
    />
  );
}

export function Sidebar() {
  const { books, chapters, currentBookId, currentChapterId, loadBooks, selectBook, createBook, createChapter, selectChapter, reloadChapters, reorderChapters } = useWorkspace();
  const renameChapter = useWorkspace((s) => s.renameChapter);
  const deleteChapter = useWorkspace((s) => s.deleteChapter);
  const renameBook = useWorkspace((s) => s.renameBook);
  const deleteBook = useWorkspace((s) => s.deleteBook);
  const labels = useMeta((s) => s.labels);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const renaming = useBinder((s) => s.renaming);
  const startRename = useBinder((s) => s.startRename);
  const stopRename = useBinder((s) => s.stopRename);
  const [newBook, setNewBook] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => { loadBooks(); }, [loadBooks]);

  const newChapterAfter = async (afterId: number | null) => {
    const created = await createChapter("新章节", { afterId, select: true });
    if (created) startRename({ kind: "chapter", id: created.id });
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

  const askDeleteBook = async (b: Book) => {
    const ok = await confirmDialog({
      title: `删除《${b.title}》？`,
      message: "整本书会移到书籍回收站（可从回收站或稍后弹出的提示里撤销）。",
      confirmLabel: "移到回收站",
      danger: true,
    });
    if (ok) await deleteBook(b.id);
  };

  const bookMenu = (b: Book): MenuEntry[] => [
    { label: "打开", icon: FolderOpen, onSelect: () => void selectBook(b.id) },
    { label: "重命名", icon: Pencil, shortcut: "F2", onSelect: () => startRename({ kind: "book", id: b.id }) },
    { type: "separator" },
    { label: "删除这本书…", icon: Trash2, danger: true, onSelect: () => void askDeleteBook(b) },
  ];

  const isRenaming = (kind: "chapter" | "book", id: number) => renaming?.kind === kind && renaming.id === id;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)] text-sm">
      {/* 顶部：应用标题 + 折叠入口（设置入口已迁至 Ribbon 底部） */}
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-[color:var(--border-subtle)] pl-4 pr-2">
        <div className="text-[15px] font-semibold tracking-wide text-[color:var(--text-primary)]">笔仙</div>
        <button
          onClick={toggleSidebar}
          title="折叠侧栏（Ctrl+B）"
          className="rounded-md p-1.5 text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* 书籍列表 */}
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-2 py-3">
        {/* 头部行兼作回收站面板定位锚点（面板 absolute top-full）；按钮带 data-trash-toggle
            供 TrashPanel 的点击外部关闭逻辑豁免，避免「开→关→再开」抖动 */}
        <div className="relative mb-1.5 flex items-center px-2">
          <span className="flex-1 text-xs text-[color:var(--text-faint)]">书籍</span>
          {/* 导入常驻：空库时也要能凭 txt 重建书库（向导会以文件名自动建书）；导出需要已有书 */}
          <button
            onClick={() => setImportOpen(true)}
            title="导入章节"
            className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <FileUp size={13} />
          </button>
          {currentBookId != null && (
            <button
              onClick={() => setExportOpen(true)}
              title="导出全书"
              className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <FileDown size={13} />
            </button>
          )}
          <button
            data-trash-toggle
            onClick={() => setTrashOpen((v) => !v)}
            title="回收站"
            className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <Trash2 size={13} />
          </button>
          {trashOpen && <TrashPanel bookId={currentBookId} onClose={() => setTrashOpen(false)} />}
        </div>
        {books.map((b) => {
          const active = currentBookId === b.id;
          return (
            <div
              key={b.id}
              tabIndex={0}
              data-book-row={b.id}
              onClick={() => selectBook(b.id)}
              onDoubleClick={() => startRename({ kind: "book", id: b.id })}
              onContextMenu={(e) => openContextMenu(e, bookMenu(b))}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "F2") {
                  e.preventDefault();
                  startRename({ kind: "book", id: b.id });
                } else if (e.key === "Enter") {
                  void selectBook(b.id);
                }
              }}
              className={`relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 outline-none transition-colors duration-150 focus-visible:[box-shadow:var(--focus-ring)] ${rowTone(active)}`}
            >
              {active && <ActiveBar />}
              <BookOpen size={14} className={active ? "shrink-0 text-[color:var(--accent)]" : "shrink-0"} />
              {isRenaming("book", b.id) ? (
                <RenameInput
                  initial={b.title}
                  onCommit={(v) => {
                    stopRename();
                    void renameBook(b.id, v);
                  }}
                  onCancel={stopRename}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate">{b.title}</span>
              )}
              {active && !isRenaming("book", b.id) && (
                <span className="shrink-0 text-xs text-[color:var(--text-faint)]">{chapters.length} 章</span>
              )}
            </div>
          );
        })}
        <InlineInput
          value={newBook}
          placeholder="新书名，回车创建…"
          title="新建书籍"
          onChange={setNewBook}
          onSubmit={async () => {
            if (newBook.trim()) {
              await createBook(newBook.trim());
              setNewBook("");
            }
          }}
        />
      </div>

      {/* 章节列表（相对书籍行缩进） */}
      <div className="flex-1 overflow-y-auto px-2 py-3">
        <div className="mb-1.5 px-2 text-xs text-[color:var(--text-faint)]">章节</div>
        {chapters.map((c) => {
          const active = currentChapterId === c.id;
          // Scrivener 式标签色点：章打了标签时替换默认文件图标色
          const label = labels.find((l) => l.id === c.label_id) ?? null;
          const editing = isRenaming("chapter", c.id);
          return (
            <div
              key={c.id}
              tabIndex={0}
              data-chapter-row={c.id}
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
              onClick={() => selectChapter(c.id)}
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
              className={`relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-5 pr-2 outline-none transition-colors duration-150 focus-visible:[box-shadow:var(--focus-ring)] ${rowTone(active)} ${dragId === c.id ? "opacity-40" : ""}`}
            >
              {active && <ActiveBar />}
              <FileText
                size={14}
                className={`shrink-0 ${label ? "" : active ? "text-[color:var(--accent)]" : ""}`}
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
                  <span className="shrink-0 text-xs text-[color:var(--text-faint)]">{c.word_count} 字</span>
                </>
              )}
            </div>
          );
        })}
        {currentBookId != null && (
          <InlineInput
            value={newChapter}
            placeholder="新章节，回车创建…"
            title="新建章节（Ctrl+N 在当前章后新建）"
            onChange={setNewChapter}
            onSubmit={async () => {
              if (newChapter.trim()) {
                await createChapter(newChapter.trim());
                setNewChapter("");
              }
            }}
          />
        )}
      </div>

      {/* 底部：今日字数 + 从磁盘重建索引 */}
      <div className="shrink-0 border-t border-[color:var(--border-subtle)] p-2">
        <StatsBadge />
        <button
          onClick={async () => {
            try {
              const n = await api.rescanLibrary();
              await loadBooks();
              await reloadChapters();
              toast.success(`已从磁盘重建索引，共 ${n} 章`);
            } catch (e) {
              toast.error(`重建索引失败：${errMsg(e)}`);
            }
          }}
          title="从磁盘 markdown 文件重建数据库索引"
          className="flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <RotateCcw size={14} />
          重建索引
        </button>
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
          bookTitle={books.find((b) => b.id === currentBookId)?.title ?? "导出"}
          chapters={chapters}
          onClose={() => setExportOpen(false)}
        />
      )}
    </div>
  );
}
