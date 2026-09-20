import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FileUp } from "lucide-react";
import { api, type ParsedChapter } from "../../lib/tauri";
import { Badge } from "../ui/Badge";
import { Modal } from "../ui/Modal";

// M2-T8 导入向导：选文件 → Rust 侧编码检测 + 分章 → 勾选 → 批量落库。
// 卷信息（volume）只用于这里的分组展示——chapters 表没有卷字段，不落库。
// 默认全选：绝大多数场景就是「整本导进来」。

export function ImportWizard(props: {
  /** 当前选中书 id（null = 空库）。默认导入为「新书」——一个文件一本书，
   *  防止连续导入把几本书的章节全并进当前书（用户实际踩过的坑） */
  bookId: number | null;
  onClose: () => void;
  /** 导入成功后回调（回传实际落库的书 id；父组件负责刷新/选中新书） */
  onImported: (bookId: number) => void;
}) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ParsedChapter[]>([]);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // M4-T4 疑似重复章（与当前书已落库内容 MD5 命中），默认不勾选
  const [dups, setDups] = useState<Set<number>>(new Set());
  // 默认导入为新书；有选中书时才允许切换为「并入当前书」
  const [intoCurrent, setIntoCurrent] = useState(false);

  // M4-T4 查重：与当前书已落库章比对（无选中书 / 查重失败都不阻断导入）
  const computeDups = async (parsed: ParsedChapter[]): Promise<Set<number>> => {
    if (props.bookId == null) return new Set<number>();
    try {
      const flags = await api.checkDuplicates(
        props.bookId,
        parsed.map((p) => p.content),
      );
      return new Set(flags.flatMap((dup, i) => (dup ? [i] : [])));
    } catch {
      return new Set<number>();
    }
  };

  // 解析结果统一入列：默认全选但排除疑似重复（等查重回来再定勾选，避免竞态）
  const applyParsed = async (name: string, parsed: ParsedChapter[], emptyMsg: string) => {
    setFileName(name);
    setReport(null);
    setItems(parsed);
    const d = await computeDups(parsed);
    setDups(d);
    setPicked(new Set(parsed.map((_, i) => i).filter((i) => !d.has(i))));
    setError(parsed.length === 0 ? emptyMsg : null);
  };

  const choose = async () => {
    try {
      const sel = await open({
        multiple: false,
        filters: [
          { name: "文本", extensions: ["txt", "md"] },
          { name: "Word 文档", extensions: ["docx"] },
        ],
      });
      if (typeof sel !== "string") return;
      await applyParsed(sel.split(/[\\/]/).pop() ?? sel, await api.previewImport(sel), "没有从文件中解析出任何章节");
    } catch (e) {
      setItems([]);
      setPicked(new Set());
      setError(String(e));
    }
  };

  // M4-T3 选文件夹：目录内 *.md/*.txt 按文件名自然序一文件一章（文件名去序号作章题）
  const chooseDir = async () => {
    try {
      const sel = await open({ directory: true });
      if (typeof sel !== "string") return;
      const name = `${sel.split(/[\\/]/).pop() ?? sel}（文件夹）`;
      await applyParsed(name, await api.previewImportDir(sel), "文件夹里没有可导入的 .md/.txt 文件");
    } catch (e) {
      setItems([]);
      setPicked(new Set());
      setError(String(e));
    }
  };

  const toggle = (i: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const run = async () => {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      // 默认以文件名（去扩展名）建书——「一个文件一本书」是用户心智（books-reader 同款）
      let bookId = props.bookId;
      if (bookId == null || !intoCurrent) {
        const name = (fileName ?? "")
          .replace(/\.(txt|md|docx)$/i, "")
          .replace(/（文件夹）$/, "")
          .trim() || "导入的书";
        bookId = (await api.createBook(name)).id;
      }
      const chosen = items.filter((_, i) => picked.has(i));
      const r = await api.importChapters(bookId, chosen);
      setReport(`已导入 ${r.chapters} 章（${intoCurrent ? "并入当前书" : "新书已创建"}），共 ${r.words.toLocaleString()} 字`);
      setItems([]);
      setPicked(new Set());
      setFileName(null);
      setError(null);
      props.onImported(bookId);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const totalWords = items.reduce(
    (n, c, i) => (picked.has(i) ? n + c.content.replace(/\s/g, "").length : n),
    0,
  );
  // 卷分组：只在结果里确实带卷时才分组展示
  const volumes = [...new Set(items.map((c) => c.volume))];

  return (
    <Modal
      open
      onClose={props.onClose}
      title="导入"
      widthClass="max-w-lg"
      testId="import-backdrop"
    >
        <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] px-4 py-3">
          <button
            onClick={() => void choose()}
            className="flex items-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <FileUp size={13} />
            选择文件
          </button>
          <button
            onClick={() => void chooseDir()}
            className="flex items-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <FolderOpen size={13} />
            选文件夹
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">
            {fileName ?? "支持 .txt / .md / .docx"}
          </span>
          {items.length > 0 && (
            <span className="shrink-0 text-xs text-[color:var(--text-faint)]">
              {picked.size}/{items.length} 章
            </span>
          )}
        </div>

        {error && <div className="px-4 py-2 text-xs text-[color:var(--danger)]">{error}</div>}
        {report && <div className="px-4 py-2 text-xs text-[color:var(--success)]">{report}</div>}

        {props.bookId != null && items.length > 0 && (
          <label className="flex shrink-0 cursor-pointer items-center gap-2 border-b border-[color:var(--border-subtle)] px-4 py-2 text-xs text-[color:var(--text-secondary)]">
            <input
              type="checkbox"
              checked={intoCurrent}
              onChange={() => setIntoCurrent((v) => !v)}
              className="shrink-0 accent-[color:var(--accent)]"
              data-testid="into-current"
            />
            并入当前书（不勾选则按文件名新建一本书）
          </label>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {items.length === 0 ? (
            <div className="px-3 py-8 text-center text-xs text-[color:var(--text-faint)]">
              选择文件后可在这里预览分章结果
            </div>
          ) : (
            volumes.map((vol, vi) => (
              <div key={vi}>
                {vol != null && (
                  <div className="px-2 pb-1 pt-2 text-[11px] text-[color:var(--text-faint)]">{vol}</div>
                )}
                {items.map((c, i) =>
                  c.volume !== vol ? null : (
                    <label
                      key={i}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                    >
                      <input
                        type="checkbox"
                        checked={picked.has(i)}
                        onChange={() => toggle(i)}
                        className="shrink-0 accent-[color:var(--accent)]"
                      />
                      <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-primary)]">
                        {c.title}
                      </span>
                      <span className="shrink-0 text-[11px] text-[color:var(--text-faint)]">
                        {c.content.replace(/\s/g, "").length} 字
                      </span>
                      {dups.has(i) && (
                        <Badge tone="amber" title="当前书里已有相同内容的章">
                          疑似重复
                        </Badge>
                      )}
                    </label>
                  ),
                )}
              </div>
            ))
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[color:var(--border-subtle)] px-4 py-3">
          <button
            onClick={() =>
              setPicked(picked.size === items.length ? new Set() : new Set(items.map((_, i) => i)))
            }
            disabled={items.length === 0}
            className="text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            {picked.size === items.length && items.length > 0 ? "全不选" : "全选"}
          </button>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-[color:var(--text-faint)]">
              {totalWords > 0 && `约 ${totalWords.toLocaleString()} 字`}
            </span>
            <button
              onClick={() => void run()}
              disabled={busy || picked.size === 0}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-40"
            >
              {busy ? "导入中…" : `导入 ${picked.size} 章`}
            </button>
          </div>
        </div>
    </Modal>
  );
}
