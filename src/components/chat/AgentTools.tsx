import { useState } from "react";
import {
  Brain,
  Check,
  ChevronRight,
  FileText,
  FolderInput,
  Globe,
  Loader2,
  Pencil,
  Redo2,
  Search,
  SquareTerminal,
  Trash2,
  Undo2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AgentToolEntry, FileChange } from "../../lib/tauri";

// agent 工具调用（阶段 2B，Cursor / Claude Code 式折叠）：默认收成一行「调用了 N 个工具」，
// 展开看每一步（类别、状态、涉及文件、增删行数）；回合改了书里的文件时另列改动，可一键全部撤销 / 恢复。

export const TOOL_KIND_LABEL: Record<string, string> = {
  read: "读取",
  edit: "编辑",
  delete: "删除",
  move: "移动",
  search: "搜索",
  execute: "执行命令",
  think: "思考",
  fetch: "联网",
  switch_mode: "切换模式",
  other: "其他",
};

const KIND_ICON: Record<string, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  delete: Trash2,
  move: FolderInput,
  search: Search,
  execute: SquareTerminal,
  think: Brain,
  fetch: Globe,
};

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <Check size={12} className="mt-0.5 shrink-0 text-[color:var(--success)]" />;
  if (status === "failed") return <X size={12} className="mt-0.5 shrink-0 text-[color:var(--danger)]" />;
  return <Loader2 size={12} className="mt-0.5 shrink-0 animate-spin text-[color:var(--text-faint)]" />;
}

export function AgentTools({ tools, live = false }: { tools: AgentToolEntry[]; live?: boolean }) {
  const [open, setOpen] = useState(false);
  if (tools.length === 0) return null;
  const failed = tools.filter((t) => t.status === "failed").length;
  const running = tools.some((t) => t.status === "pending" || t.status === "in_progress");
  const last = tools[tools.length - 1];
  return (
    <div data-agent-tools={tools.length} className="rounded-[var(--r-control)] border border-[color:var(--hairline)] text-xs">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? "收起工具调用" : "展开工具调用"}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[color:var(--text-secondary)] transition-colors hover:bg-[var(--fill-hover)]"
      >
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <Wrench size={12} className="shrink-0" />
        <span className="shrink-0">调用了 {tools.length} 个工具</span>
        {failed > 0 && <span className="shrink-0 text-[color:var(--danger)]">· {failed} 个失败</span>}
        {live && running && !open && <span className="min-w-0 truncate text-[color:var(--text-faint)]">· {last.title}</span>}
        {live && running && <Loader2 size={11} className="ml-auto shrink-0 animate-spin" />}
      </button>
      {open && (
        <ul className="space-y-1 border-t border-[color:var(--hairline)] px-2 py-1.5">
          {tools.map((t) => {
            const Icon = KIND_ICON[t.kind] ?? Wrench;
            return (
              <li key={t.id} data-tool-status={t.status} className="flex items-start gap-1.5">
                <StatusIcon status={t.status} />
                <Icon size={12} className="mt-0.5 shrink-0 text-[color:var(--text-faint)]" />
                <span className="min-w-0 flex-1">
                  <span className="text-[color:var(--text-primary)]">{t.title}</span>
                  <span className="ml-1.5 text-2xs text-[color:var(--text-faint)]">{TOOL_KIND_LABEL[t.kind] ?? t.kind}</span>
                  {(t.added > 0 || t.removed > 0) && (
                    <span className="ml-1.5 text-2xs tabular-nums">
                      <span className="text-[color:var(--success)]">+{t.added}</span> <span className="text-[color:var(--danger)]">−{t.removed}</span>
                    </span>
                  )}
                  {t.paths.length > 0 && (
                    <span className="block truncate text-2xs text-[color:var(--text-faint)]" title={t.paths.join("\n")}>
                      {t.paths.join("、")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const CHANGE_LABEL: Record<string, string> = { added: "新增", modified: "修改", deleted: "删除" };
const CHANGE_TONE: Record<string, string> = {
  added: "text-[color:var(--success)]",
  modified: "text-[color:var(--warning)]",
  deleted: "text-[color:var(--danger)]",
};

export function AgentChanges({ changes, undone, canUndo, onToggle }: { changes: FileChange[]; undone: boolean; canUndo: boolean; onToggle: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (changes.length === 0) return null;
  return (
    <div data-agent-changes={changes.length} data-undone={undone ? "1" : "0"} className="rounded-[var(--r-control)] border border-[color:var(--hairline)] px-2 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        <span className={undone ? "text-[color:var(--text-faint)] line-through" : "text-[color:var(--text-secondary)]"}>AI 改动了 {changes.length} 个文件</span>
        {undone && <span className="text-2xs text-[color:var(--text-faint)]">已撤销</span>}
        <span className="flex-1" />
        {canUndo && (
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onToggle();
              } finally {
                setBusy(false);
              }
            }}
            className="flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-2xs text-[color:var(--accent)] transition-colors hover:bg-[var(--fill-hover)] disabled:opacity-40"
          >
            {undone ? <Redo2 size={11} /> : <Undo2 size={11} />}
            {undone ? "恢复 AI 改动" : "撤销全部改动"}
          </button>
        )}
      </div>
      <ul className="mt-1 space-y-0.5">
        {changes.map((c) => (
          <li key={c.path} className="flex items-center gap-1.5 text-2xs">
            <span className={`shrink-0 ${CHANGE_TONE[c.kind] ?? ""}`}>{CHANGE_LABEL[c.kind] ?? c.kind}</span>
            <span className="min-w-0 truncate text-[color:var(--text-secondary)]" title={c.path}>
              {c.path}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
