import { Layers } from "lucide-react";
import type { AssemblyLog } from "../../lib/tauri";

// 上下文预览：把「本次续写注入了哪些槽位」摊开给用户看（规格 §4.4：黑盒注入视为缺陷）。
// log 为 null 时空态；loading 只影响空态文案，已有结果时保持旧结果不闪。
export function ContextPreview({ log, loading }: { log: AssemblyLog | null; loading: boolean }) {
  if (log == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-3 text-center">
        <Layers size={28} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
        <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">
          {loading ? "正在组装上下文…" : "点击刷新查看本次续写的上下文组装"}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-3 pt-2 text-xs text-[color:var(--text-secondary)]">
        共 {log.slots.length} 个槽位 · 估算 {log.total_est_tokens} tokens
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
        {log.slots.map((s, i) => (
          <div key={i} className="rounded-md border border-[color:var(--border-subtle)] p-2.5">
            <div className="flex items-baseline gap-2">
              <span className="shrink-0 text-xs font-medium text-[color:var(--text-primary)]">{s.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">{s.source}</span>
              <span className="shrink-0 text-xs text-[color:var(--text-faint)]">
                {s.chars} 字 / ~{s.est_tokens} tokens
              </span>
            </div>
            <pre className="mt-1.5 whitespace-pre-wrap rounded bg-[var(--bg-elevated)] px-2 py-1.5 font-mono text-xs leading-relaxed text-[color:var(--text-secondary)]">
              {s.preview_head}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
