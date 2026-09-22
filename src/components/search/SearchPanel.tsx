import { useEffect, useRef, useState } from "react";
import { BookmarkPlus, CornerDownLeft, Search, X } from "lucide-react";
import { useSearch } from "../../stores/search";
import { useWorkspace } from "../../stores/workspace";
import { api, type SearchHit } from "../../lib/tauri";
import { Modal } from "../ui/Modal";

// M2-T9 全书搜索结果面板（Ctrl+Shift+F 唤起，Esc 关闭）。
// 输入 300ms 防抖后查询；结果按章分组，点击命中跳章并定位到该行。

/** 命中行高亮：match_start/end 是字符索引，按字符切分（CJK 下与 JS 下标一致） */
function HitLine(props: { hit: SearchHit }) {
  const chars = Array.from(props.hit.line_text);
  return (
    <span className="block truncate">
      {chars.slice(0, props.hit.match_start).join("")}
      <mark className="rounded-sm bg-[color:var(--accent)]/35 text-[color:var(--text-primary)]">
        {chars.slice(props.hit.match_start, props.hit.match_end).join("")}
      </mark>
      {chars.slice(props.hit.match_end).join("")}
    </span>
  );
}

const SCOPES: { value: string; label: string; title: string }[] = [
  { value: "all", label: "全部", title: "标题+正文" },
  { value: "title", label: "标题", title: "仅搜章节标题" },
  { value: "content", label: "正文", title: "仅搜正文" },
];

export function SearchPanel() {
  const { open, query, wholeWord, scope, hits, truncated, loading, error, closePanel, setQuery, setWholeWord, setScope, search, jump } =
    useSearch();
  const bookId = useWorkspace((s) => s.currentBookId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | string>("idle");

  // 打开时聚焦（Esc 关闭由 Modal 承担）
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  // 300ms 防抖：输入停顿后才真正查询（Rust 侧是全书线性扫描）
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void search(bookId), 300);
    return () => clearTimeout(t);
  }, [open, query, wholeWord, scope, bookId, search]);

  // 查询变化后重置保存态
  useEffect(() => setSaveState("idle"), [query, scope]);

  const saveAsCollection = async () => {
    if (bookId == null || query.trim() === "" || saveState === "saving") return;
    setSaveState("saving");
    try {
      await api.collectionUpsert({ id: null, book_id: bookId, name: query.trim(), kind: "saved", query: query.trim() });
      setSaveState("saved");
    } catch (e) {
      setSaveState(String(e).replace(/^.*?"|".*$/g, "") || String(e));
    }
  };

  if (!open) return null;

  // 结果已按章序返回，同章的连续命中合并成一组
  const groups: { id: number; title: string; items: SearchHit[] }[] = [];
  for (const h of hits) {
    const last = groups[groups.length - 1];
    if (last && last.id === h.chapter_id) last.items.push(h);
    else groups.push({ id: h.chapter_id, title: h.chapter_title, items: [h] });
  }

  return (
    <Modal
      open={open}
      onClose={closePanel}
      align="top"
      widthClass="max-w-2xl"
      maxHeightClass="max-h-[70vh]"
      testId="search-backdrop"
    >
        <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] px-3 py-2">
          <Search size={14} className="shrink-0 text-[color:var(--text-faint)]" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={bookId == null ? "请先选择书籍" : "搜索全书…"}
            disabled={bookId == null}
            className="min-w-0 flex-1 bg-transparent text-sm text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
          <div className="flex shrink-0 items-center gap-0.5">
            {SCOPES.map((sc) => (
              <button
                key={sc.value}
                onClick={() => setScope(sc.value)}
                title={sc.title}
                className={`rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 hover:bg-[var(--bg-hover)] ${
                  scope === sc.value
                    ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-faint)]"
                }`}
              >
                {sc.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setWholeWord(!wholeWord)}
            title="全词匹配"
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] transition-colors duration-150 hover:bg-[var(--bg-hover)] ${
              wholeWord ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]" : "text-[color:var(--text-faint)]"
            }`}
          >
            全词
          </button>
          <button
            onClick={closePanel}
            title="关闭"
            className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--text-primary)]"
          >
            <X size={13} />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-3 py-1.5 text-[11px] text-[color:var(--text-faint)]">
          <span className="min-w-0 flex-1 truncate">
            {error ? (
              <span className="text-[color:var(--danger)]">{error}</span>
            ) : query.trim() === "" ? (
              "空格=同时包含 · -词=排除 · \"短语\"=词组"
            ) : loading ? (
              "搜索中…"
            ) : hits.length === 0 ? (
              "没有找到匹配"
            ) : saveState === "idle" || saveState === "saving" ? (
              <>
                共 {hits.length} 处命中
                {truncated && <span className="text-[color:var(--warning)]">（结果过多，已截断）</span>}
              </>
            ) : saveState === "saved" ? (
              <span className="text-[color:var(--success, var(--accent))]">已存为集合「{query.trim()}」</span>
            ) : (
              <span className="text-[color:var(--danger)]">{saveState}</span>
            )}
          </span>
          {query.trim() !== "" && bookId != null && hits.length > 0 && saveState === "idle" && (
            <button
              onClick={() => void saveAsCollection()}
              title="把当前查询存为搜索集合（写入写作区右侧「集合」面板）"
              className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <BookmarkPlus size={11} />
              存为集合
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
          {groups.map((g) => (
            <div key={g.id} className="mb-1">
              <div className="px-2 py-1 text-[11px] font-medium text-[color:var(--text-secondary)]">
                {g.title}
                <span className="ml-1 text-[color:var(--text-faint)]">({g.items.length})</span>
              </div>
              {g.items.map((h, i) => (
                <button
                  key={i}
                  onClick={() => void jump(h)}
                  title="跳到此行"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                >
                  <span className="w-8 shrink-0 text-right text-[11px] text-[color:var(--text-faint)]">
                    {h.line_no}
                  </span>
                  <HitLine hit={h} />
                </button>
              ))}
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-1.5 border-t border-[color:var(--border-subtle)] px-3 py-1.5 text-[11px] text-[color:var(--text-faint)]">
          <CornerDownLeft size={11} />
          点击结果跳转到该章并定位
        </div>
    </Modal>
  );
}
