import { useEffect, useState } from "react";
import { api, ChapterContent } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

// 串烧（Scrivener Scrivenings 移植）：多章按目录序拼接成一篇连读文档。
// 只读——每章=标题 + 梗概（可选）+ 正文，章节间以横隔线分开。
// 进入模式时挂载并按需拉全文（本地文件，量级可控）；切模式即卸载。

export function Scrivenings() {
  const bookId = useWorkspace((s) => s.currentBookId);
  const chapters = useWorkspace((s) => s.chapters);
  const [docs, setDocs] = useState<ChapterContent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (bookId == null || chapters.length === 0) return;
    let cancelled = false;
    setDocs(null);
    setError(null);
    Promise.all(chapters.map((c) => api.readChapter(c.id)))
      .then((all) => !cancelled && setDocs(all))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [bookId, chapters.length]);

  if (docs == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">
        {error ?? "正在拼接全文…"}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {docs.map((d, i) => (
        <div key={d.meta.id}>
          {i > 0 && <hr className="my-6 border-[color:var(--border-subtle)]" />}
          <h3 className="mb-2 text-center text-sm font-semibold tracking-wide text-[color:var(--text-primary)]">
            {d.meta.title}
          </h3>
          {d.meta.synopsis && (
            <p className="mb-3 text-center text-xs italic text-[color:var(--text-faint)]">{d.meta.synopsis}</p>
          )}
          <div className="whitespace-pre-wrap text-sm leading-loose text-[color:var(--text-secondary)]">
            {d.content || <span className="italic text-[color:var(--text-faint)]">（本章暂无正文）</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
