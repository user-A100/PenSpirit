import { Modal } from "../ui/Modal";
import { Badge } from "../ui/Badge";

// M4 T6 占位符扫描（webnovel-writer placeholder_scanner 移植）：
// 写前阻断——四类占位符命中即列出（章内 markdown 行号），替换完再交稿。
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\[待[^\]\n]*\]/g, label: "[待…]" },
  { re: /（暂名[^）\n]*）|\(暂名[^)\n]*\)/g, label: "（暂名）" },
  { re: /【待[^】\n]*】/g, label: "【待…】" },
  { re: /\{[^}\n]{1,30}\}/g, label: "{…}" }, // 限长防误吞正文
];

export interface PlaceholderHit {
  line: number;
  text: string;
  label: string;
}

export function scanPlaceholders(md: string): PlaceholderHit[] {
  const hits: (PlaceholderHit & { start: number })[] = [];
  md.split("\n").forEach((line, i) => {
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of line.matchAll(p.re)) {
        hits.push({ line: i + 1, start: m.index ?? 0, text: m[0], label: p.label });
      }
    }
  });
  // 按文档序（行、列）排列——逐 pattern 收集会打乱行内先后
  return hits.sort((a, b) => a.line - b.line || a.start - b.start);
}

export function PlaceholderDialog(props: { content: string; onClose: () => void }) {
  const hits = scanPlaceholders(props.content);
  return (
    <Modal open onClose={props.onClose} title="占位符扫描" widthClass="max-w-lg" testId="placeholder-backdrop">
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] px-4 py-3 text-[11px] text-[color:var(--text-faint)]">
        {hits.length === 0 ? "未发现占位符，可以安心交稿" : `发现 ${hits.length} 处占位符——写完前请替换`}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {hits.map((h, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1 text-xs text-[color:var(--text-secondary)]"
          >
            <span className="w-10 shrink-0 text-right text-[11px] text-[color:var(--text-faint)]">{h.line} 行</span>
            <Badge tone="amber">{h.label}</Badge>
            <span className="min-w-0 flex-1 truncate">{h.text}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}
