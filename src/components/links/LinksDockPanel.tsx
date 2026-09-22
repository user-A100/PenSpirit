import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, RefreshCw, UserRound, Unlink } from "lucide-react";
import { api, type Backlink, type CharacterMention, type WikiLink } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

// 链接面板（M7 批次3，Scrivener「Links are Circular」移植）：
// 本章出链 / 反向链接 / 人物提及。数据由 Rust 扫描 md 正文里的 [[章题]] 派生，
// 不落库——切章自动重扫；保存后的更新点刷新按钮。

export function LinksDockPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selectChapter = useWorkspace((s) => s.selectChapter);
  const [links, setLinks] = useState<WikiLink[] | null>(null);
  const [backlinks, setBacklinks] = useState<Backlink[] | null>(null);
  const [mentions, setMentions] = useState<CharacterMention[] | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (currentBookId == null || currentChapterId == null) return;
    let cancelled = false;
    setLinks(null);
    setBacklinks(null);
    setMentions(null);
    Promise.all([
      api.linksScan(currentBookId),
      api.chapterBacklinks(currentChapterId),
      api.characterMentions(currentBookId),
    ])
      .then(([ls, bs, ms]) => {
        if (cancelled) return;
        setLinks(ls.filter((l) => l.from_id === currentChapterId));
        setBacklinks(bs);
        setMentions(ms);
      })
      .catch((e) => !cancelled && console.warn(e));
    return () => {
      cancelled = true;
    };
  }, [currentBookId, currentChapterId, reload]);

  // 人物按 id 聚合：名字 → 总提及次数 + 涉及章（按次数倒序）
  const mentionRows = useMemo(() => {
    if (!mentions) return [];
    const map = new Map<number, { name: string; count: number; chapters: string[] }>();
    for (const m of mentions) {
      const row = map.get(m.character_id) ?? { name: m.name, count: 0, chapters: [] };
      row.count += m.count;
      row.chapters.push(m.chapter_title);
      map.set(m.character_id, row);
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [mentions]);

  if (currentChapterId == null) {
    return <div className="flex h-full items-center justify-center p-4 text-xs text-[color:var(--text-faint)]">先选一章</div>;
  }

  const loading = links == null || backlinks == null || mentions == null;

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-xs">
      <button
        onClick={() => setReload((v) => v + 1)}
        title="重新扫描（保存后更新链接）"
        className="mb-2 flex shrink-0 items-center justify-center gap-1 rounded-md border border-[color:var(--border-subtle)] py-1 text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
      >
        <RefreshCw size={11} className={loading ? "animate-spin" : ""} />
        重新扫描
      </button>

      {/* 出链 */}
      <Section title={`出链（${links?.length ?? 0}）`}>
        {(links?.length ?? 0) === 0 && <Empty text="正文里还没有 [[章题]] 链接" />}
        {links?.map((l, i) => {
          const resolved = l.to_id != null;
          return (
            <button
              key={`${l.target}-${i}`}
              onClick={() => resolved && void selectChapter(l.to_id!)}
              disabled={!resolved}
              title={resolved ? `跳到「${l.to_title}」` : "目标章不存在"}
              className="mb-1 block w-full rounded-md border border-[color:var(--border-subtle)] px-2 py-1.5 text-left transition-colors duration-150 disabled:cursor-default disabled:opacity-60 enabled:hover:border-[color:var(--accent)]"
            >
              <span className="flex items-center gap-1.5">
                {resolved ? (
                  <ArrowRight size={11} className="shrink-0 text-[color:var(--accent)]" />
                ) : (
                  <Unlink size={11} className="shrink-0 text-[color:var(--text-faint)]" />
                )}
                <span className={`min-w-0 flex-1 truncate ${resolved ? "text-[color:var(--text-primary)]" : "text-[color:var(--text-faint)]"}`}>
                  {l.target}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-[color:var(--text-faint)]">{l.snippet}</span>
            </button>
          );
        })}
      </Section>

      {/* 反向链接 */}
      <Section title={`反向链接（${backlinks?.length ?? 0}）`}>
        {(backlinks?.length ?? 0) === 0 && <Empty text="还没有别的章链到本章" />}
        {backlinks?.map((b, i) => (
          <button
            key={`${b.from_id}-${i}`}
            onClick={() => void selectChapter(b.from_id)}
            title={`跳到「${b.from_title}」`}
            className="mb-1 block w-full rounded-md border border-[color:var(--border-subtle)] px-2 py-1.5 text-left transition-colors duration-150 hover:border-[color:var(--accent)]"
          >
            <span className="flex items-center gap-1.5">
              <ArrowLeft size={11} className="shrink-0 text-[color:var(--accent)]" />
              <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{b.from_title}</span>
            </span>
            <span className="mt-0.5 block truncate text-[10px] text-[color:var(--text-faint)]">{b.snippet}</span>
          </button>
        ))}
      </Section>

      {/* 人物提及 */}
      <Section title={`人物提及（${mentionRows.length}）`}>
        {mentionRows.length === 0 && <Empty text="本章没有提到人物卡里的人（含别名）" />}
        {mentionRows.map((row) => (
          <div
            key={row.name}
            title={row.chapters.join("、")}
            className="mb-1 flex items-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] px-2 py-1.5"
          >
            <UserRound size={11} className="shrink-0 text-[color:var(--accent)]" />
            <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{row.name}</span>
            <span className="shrink-0 text-[10px] text-[color:var(--text-faint)]">
              {row.count} 次 · {row.chapters.length} 章
            </span>
          </div>
        ))}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[color:var(--text-faint)]">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mb-1 rounded-md px-2 py-1.5 text-[color:var(--text-faint)]">{text}</div>;
}
