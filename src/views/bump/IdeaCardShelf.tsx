import { Trash2 } from "lucide-react";
import { parseList, useBump } from "../../stores/bump";
import { Card } from "../../components/ui/Card";

// 灵感卡陈列架：词组 × 组合 + 标签 + 备注 + 时间。
// words_json/tags_json 是后端存的 JSON 数组字符串，这里解析展示（坏数据退化为空）。

export function IdeaCardShelf() {
  const ideas = useBump((s) => s.ideas);
  const removeIdea = useBump((s) => s.removeIdea);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-[color:var(--border-subtle)] px-4">
        <span className="text-sm font-semibold text-[color:var(--text-primary)]">灵感卡</span>
        {ideas.length > 0 && (
          <span className="ml-1.5 text-xs text-[color:var(--text-faint)]">({ideas.length})</span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {ideas.length === 0 ? (
          <div className="px-2 py-8 text-center text-xs text-[color:var(--text-faint)]">
            碰撞出满意的组合后，存成灵感卡放这里
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {ideas.map((idea) => {
              const list = parseList(idea.words_json);
              const tags = parseList(idea.tags_json);
              return (
                <Card key={idea.id} interactive className="flex flex-col">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 text-sm font-medium text-[color:var(--text-primary)]">
                      {list.join(" × ")}
                    </div>
                    <button
                      onClick={() => void removeIdea(idea.id)}
                      title="删除灵感卡"
                      className="shrink-0 rounded p-1 text-[color:var(--text-faint)] opacity-0 transition-opacity duration-[var(--dur-fast)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)] group-hover:opacity-100"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {idea.content && (
                    <div className="mt-1.5 whitespace-pre-wrap break-words text-xs text-[color:var(--text-secondary)]">
                      {idea.content}
                    </div>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-[var(--accent-dim)] px-1.5 py-0.5 text-[11px] text-[color:var(--text-secondary)]"
                      >
                        {t}
                      </span>
                    ))}
                    <span className="ml-auto text-[11px] text-[color:var(--text-faint)]">{idea.created_at}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
