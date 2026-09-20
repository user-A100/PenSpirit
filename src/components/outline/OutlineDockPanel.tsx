import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, NotebookPen, Plus, Trash2 } from "lucide-react";
import { parseHeadings } from "../../lib/headings";
import { useOutline } from "../../stores/outline";
import { useOutlinesStore } from "../../stores/outlines";
import { useWorkspace } from "../../stores/workspace";
import type { Outline } from "../../lib/tauri";

// 大纲 dock 面板（write 视图 outline tab，M4 大纲体系）。
// 三级结构（webnovel-writer 4 级大纲裁剪）：总纲（每书一篇）→ 卷纲（手动分卷）
// → 章细纲（每章一篇）。点条目进 dock 内编辑态（textarea），Esc/返回回树。
// 上部保留「本章小标题」快速定位（Alt+O 悬浮大纲同源）。

type EditorTarget =
  | { kind: "master" }
  | { kind: "volume"; id: number | null } // null=新建
  | { kind: "chapter"; chapterId: number; outlineId: number | null };

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 focus:border-[color:var(--accent)]";

export function OutlineDockPanel() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const content = useWorkspace((s) => s.chapterContent);
  const selectChapter = useWorkspace((s) => s.selectChapter);

  const list = useOutlinesStore((s) => s.list);
  const load = useOutlinesStore((s) => s.load);
  const upsert = useOutlinesStore((s) => s.upsert);
  const remove = useOutlinesStore((s) => s.remove);

  const [editing, setEditing] = useState<EditorTarget | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sortKey, setSortKey] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    void load(currentBookId);
  }, [currentBookId, load]);

  const master = list.find((o) => o.kind === "master") ?? null;
  const volumes = list.filter((o) => o.kind === "volume");
  const chapterOutlines = useMemo(
    () => new Map(list.filter((o) => o.kind === "chapter").map((o) => [o.chapter_id!, o])),
    [list],
  );

  const headings = parseHeadings(content ?? "");

  // ---- 编辑态 ----
  const openEditor = (target: EditorTarget, existing: Outline | null) => {
    setEditing(target);
    setTitle(existing?.title ?? (target.kind === "chapter" ? "" : ""));
    setBody(existing?.content ?? "");
    setSortKey(existing?.sort_key ?? (target.kind === "volume" ? volumes.length + 1 : 0));
    setError("");
  };

  const save = async () => {
    if (currentBookId == null || editing == null) return;
    const input =
      editing.kind === "chapter"
        ? {
            id: editing.outlineId,
            book_id: currentBookId,
            kind: "chapter" as const,
            chapter_id: editing.chapterId,
            title: "",
            content: body,
            sort_key: 0,
          }
        : editing.kind === "volume"
          ? {
              id: editing.id,
              book_id: currentBookId,
              kind: "volume" as const,
              chapter_id: null,
              title: title.trim(),
              content: body,
              sort_key: sortKey,
            }
          : {
              id: master?.id ?? null,
              book_id: currentBookId,
              kind: "master" as const,
              chapter_id: null,
              title: "",
              content: body,
              sort_key: 0,
            };
    const r = await upsert(input);
    if (!r.ok) {
      setError(r.error ?? "保存失败");
      return;
    }
    setEditing(null);
  };

  if (editing) {
    const heading =
      editing.kind === "master"
        ? "总纲"
        : editing.kind === "volume"
          ? editing.id == null
            ? "新建卷纲"
            : `卷纲 · ${title}`
          : `细纲 · ${chapters.find((c) => c.id === editing.chapterId)?.title ?? ""}`;
    // 总纲不提供删除（每书恒一篇，重写即可）
    const canDelete =
      editing.kind === "volume" ? editing.id != null : editing.kind === "chapter" ? editing.outlineId != null : false;
    return (
      <div className="flex h-full flex-col gap-2 p-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setEditing(null)}
            title="返回大纲树"
            className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <ChevronLeft size={15} />
          </button>
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-[color:var(--text-primary)]">
            {heading}
          </span>
          {canDelete && (
            <button
              title="删除此大纲"
              onClick={() => {
                const id = editing.kind === "volume" ? editing.id : editing.kind === "chapter" ? editing.outlineId : null;
                if (id != null) void remove(id);
                setEditing(null);
              }}
              className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
        {editing.kind === "volume" && (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="卷名（必填，如：第一卷 风雪）"
            className={INPUT}
          />
        )}
        <textarea
          autoFocus={editing.kind !== "volume"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={
            editing.kind === "master"
              ? "全书总纲：核心冲突、主线走向、结局落点……"
              : editing.kind === "volume"
                ? "本卷卷纲：阶段目标、关键事件、入卷/出卷状态……"
                : "本章细纲：场景、人物行动、转折、钩子……"
          }
          className={`${INPUT} min-h-0 flex-1 resize-none leading-relaxed`}
        />
        {error && <div className="text-[11px] text-[color:var(--danger)]">{error}</div>}
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => setEditing(null)}
            className="rounded px-2 py-1 text-[11px] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
          >
            取消
          </button>
          <button
            onClick={() => void save()}
            disabled={editing.kind === "volume" && !title.trim()}
            className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            保存
          </button>
        </div>
      </div>
    );
  }

  // ---- 树态 ----
  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      <div className="outline-sep">本章小标题</div>
      {headings.length === 0 ? (
        <div className="outline-empty">本章无小标题</div>
      ) : (
        <ul className="outline-list">
          {headings.map((h) => (
            <li
              key={`${h.level}:${h.text}`}
              className={h.level === 2 ? "lv2" : undefined}
              title={h.text}
              onClick={() => useOutline.getState().request(h.text)}
            >
              {h.text}
            </li>
          ))}
        </ul>
      )}

      <div className="outline-sep">总纲</div>
      <ul className="outline-list">
        <li
          title={master?.content || "写总纲"}
          onClick={() => openEditor({ kind: "master" }, master)}
          className="flex items-center gap-1.5"
        >
          <NotebookPen size={11} className={master?.content ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"} />
          <span className="truncate">{master?.content ? "总纲（已写）" : "总纲（未写，点击开始）"}</span>
        </li>
      </ul>

      <div className="flex items-center justify-between">
        <div className="outline-sep">卷纲</div>
        <button
          title="新建卷纲"
          onClick={() => openEditor({ kind: "volume", id: null }, null)}
          className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <Plus size={12} />
        </button>
      </div>
      {volumes.length === 0 ? (
        <div className="outline-empty">未分卷</div>
      ) : (
        <ul className="outline-list">
          {volumes.map((v) => (
            <li key={v.id} title={v.content || v.title} onClick={() => openEditor({ kind: "volume", id: v.id }, v)}>
              <span className="font-medium">{v.title}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="outline-sep">章细纲</div>
      <ul className="outline-list">
        {chapters.map((c, i) => {
          const o = chapterOutlines.get(c.id) ?? null;
          return (
            <li
              key={c.id}
              className={c.id === currentChapterId ? "active" : undefined}
              title={o?.content || `${c.title}（细纲未写）`}
              onClick={() => {
                // 点行 = 切章（保留目录语义）；点笔图标 = 进/写细纲
                if (c.id !== useWorkspace.getState().currentChapterId) void selectChapter(c.id);
              }}
            >
              <span className="flex items-center gap-1.5">
                <button
                  title={o ? "编辑细纲" : "写细纲"}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditor({ kind: "chapter", chapterId: c.id, outlineId: o?.id ?? null }, o);
                  }}
                  className="shrink-0"
                >
                  <NotebookPen
                    size={11}
                    className={o ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)]"}
                  />
                </button>
                <span className="truncate">
                  {i + 1}. {c.title}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
