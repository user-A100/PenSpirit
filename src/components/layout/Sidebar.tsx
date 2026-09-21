import { useEffect, useState } from "react";
import { BookOpen, FileDown, FileText, FileUp, PanelLeftClose, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { TrashPanel } from "../sidebar/TrashPanel";
import { StatsBadge } from "../sidebar/StatsBadge";
import { ImportWizard } from "../io/ImportWizard";
import { ExportDialog } from "../io/ExportDialog";
import { useUiNav } from "../../lib/nav/uiStore";
import { api } from "../../lib/tauri";

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
          if (e.key === "Enter") props.onSubmit();
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

export function Sidebar() {
  const { books, chapters, currentBookId, currentChapterId, loadBooks, selectBook, createBook, createChapter, selectChapter, reloadChapters, reorderChapters } = useWorkspace();
  const labels = useMeta((s) => s.labels);
  const toggleSidebar = useUiNav((s) => s.toggleSidebar);
  const [newBook, setNewBook] = useState("");
  const [newChapter, setNewChapter] = useState("");
  const [trashOpen, setTrashOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);

  useEffect(() => { loadBooks(); }, [loadBooks]);

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
              onClick={() => selectBook(b.id)}
              className={`relative flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${rowTone(active)}`}
            >
              {active && <ActiveBar />}
              <BookOpen size={14} className={active ? "shrink-0 text-[color:var(--accent)]" : "shrink-0"} />
              <span className="min-w-0 flex-1 truncate">{b.title}</span>
              {active && (
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
          return (
            <div
              key={c.id}
              draggable
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
              className={`relative flex cursor-pointer items-center gap-2 rounded-md py-1.5 pl-5 pr-2 transition-colors duration-150 ${rowTone(active)} ${dragId === c.id ? "opacity-40" : ""}`}
            >
              {active && <ActiveBar />}
              <FileText
                size={14}
                className={`shrink-0 ${label ? "" : active ? "text-[color:var(--accent)]" : ""}`}
                style={label ? { color: label.color } : undefined}
              />
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="shrink-0 text-xs text-[color:var(--text-faint)]">{c.word_count} 字</span>
            </div>
          );
        })}
        {currentBookId != null && (
          <InlineInput
            value={newChapter}
            placeholder="新章节，回车创建…"
            title="新建章节"
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
            const n = await api.rescanLibrary();
            await loadBooks();
            alert(`已重建索引，共 ${n} 章`);
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
