import { useEffect, useMemo, useState } from "react";
import { api, type ChapterContent, type ChapterMeta } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { errMsg } from "../../lib/errors";
import { useLens, type LensProps } from "./lens";

// 串烧（Scrivener Scrivenings 移植）：多章按顺序拼接成一篇连读文档（只读）。
// 阶段 3A：稿纸同款衬线排版、章题可点击直接打开该章、范围随组视图（多选 / 集合 / 整本书）。

export function Scrivenings(props: LensProps = {}) {
  const lens = useLens(props);
  const onOpen = lens.onOpen;
  const bookId = useWorkspace((s) => s.currentBookId);
  const allChapters = useWorkspace((s) => s.chapters);
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const [docs, setDocs] = useState<ChapterContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 阶段 3B：串烧包含卷的全部子孙——卷展开为「卷名 + 卷首语」再接卷内各章（已单独列出的章不重复）
  const chapters = useMemo(() => {
    const listed = new Set(lens.chapters.map((c) => c.id));
    const out: ChapterMeta[] = [];
    for (const c of lens.chapters) {
      if (c.kind === "folder") {
        out.push(c);
        for (const k of allChapters) if (k.parent_id === c.id && !listed.has(k.id)) out.push(k);
      } else out.push(c);
    }
    return out;
  }, [lens.chapters, allChapters]);
  const key = chapters.map((c) => `${c.id}:${c.updated_at}`).join(",");

  useEffect(() => {
    if (bookId == null || chapters.length === 0) return;
    let cancelled = false;
    setDocs(null);
    setError(null);
    Promise.all(chapters.map((c) => api.readChapter(c.id)))
      .then((all) => !cancelled && setDocs(all))
      .catch((e) => !cancelled && setError(errMsg(e)));
    return () => {
      cancelled = true;
    };
    // 章节集合或其更新时间变化才重读
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, key]);

  if (docs == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">
        {error ?? "正在拼接全文…"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[720px] pb-10">
      {docs.map((d, i) => {
        // 标签色 / 状态与侧栏、卡片墙、大纲列一致表达
        const label = labels.find((l) => l.id === d.meta.label_id) ?? null;
        const status = statuses.find((st) => st.id === d.meta.status_id) ?? null;
        const folder = d.meta.kind === "folder";
        return (
        <div key={d.meta.id}>
          {i > 0 && <hr className="my-8 border-0 border-t border-[color:var(--hairline)]" />}
          <div className="mb-1 flex items-center justify-center gap-2">
            {label && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label.color }} title={label.title} />}
            <button
              onClick={() => onOpen(d.meta.id)}
              title={folder ? "打开这一卷" : "打开这一章"}
              className={`rounded px-2 text-center font-semibold tracking-wide text-[color:var(--text-primary)] transition-colors hover:text-[color:var(--accent)] ${folder ? "text-md" : "text-sm"}`}
            >
              {d.meta.title}
            </button>
            {status && (
              <span className="shrink-0 rounded px-1 py-0.5 text-2xs text-[color:var(--text-secondary)]" style={{ backgroundColor: "var(--fill-element)" }}>
                {status.title}
              </span>
            )}
          </div>
          {d.meta.synopsis && (
            <p className="mb-4 text-center text-xs italic text-[color:var(--text-faint)]">{d.meta.synopsis}</p>
          )}
          <div className="ai-prose">
            {d.content.trim() ? (
              d.content
                .split("\n")
                .filter((l) => l.trim() !== "")
                .map((l, j) => <p key={j}>{l.replace(/^#+\s*/, "")}</p>)
            ) : folder ? null : (
              <span className="italic text-[color:var(--text-faint)]">（本章暂无正文）</span>
            )}
          </div>
        </div>
        );
      })}
    </div>
  );
}
