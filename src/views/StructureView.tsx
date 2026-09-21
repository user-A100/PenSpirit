import { useState } from "react";
import { Columns3, FileStack, LayoutGrid, NotebookText } from "lucide-react";
import { ViewShell } from "../components/layout/ViewShell";
import { Corkboard } from "../components/structure/Corkboard";
import { OutlinerTable } from "../components/structure/OutlinerTable";
import { Scrivenings } from "../components/structure/Scrivenings";
import { TemplateModal } from "../components/structure/TemplateModal";
import { useWorkspace } from "../stores/workspace";
import { useTemplates } from "../stores/templates";

// 结构视图（M7 批次2，Scrivener 三视图移植）：
// 卡片墙 Corkboard / 大纲列 Outliner / 串烧 Scrivenings，同一份章节清单的三种透镜。
// 另挂章节模板管理（默认模板 = 新章初始正文）。

type Mode = "corkboard" | "outliner" | "scrivenings";
const MODE_KEY = "bixian.structureMode";
const MODES: { id: Mode; label: string; icon: typeof LayoutGrid; hint: string }[] = [
  { id: "corkboard", label: "卡片墙", icon: LayoutGrid, hint: "梗概卡片 · 拖拽换序 · 双击进写作" },
  { id: "outliner", label: "大纲列", icon: Columns3, hint: "表格总览 · 点表头排序（视图透镜）" },
  { id: "scrivenings", label: "串烧", icon: FileStack, hint: "全文连读 · 只读拼接" },
];

function StructureWorkspace() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const templateCount = useTemplates((s) => s.list.length);
  const defaultTemplate = useTemplates((s) => s.list.find((t) => t.is_default) ?? null);
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem(MODE_KEY) as Mode | null;
    return saved && MODES.some((m) => m.id === saved) ? saved : "corkboard";
  });
  const [templatesOpen, setTemplatesOpen] = useState(false);

  if (currentBookId == null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[color:var(--text-faint)]">
        先选一本书
      </div>
    );
  }

  const pick = (m: Mode) => {
    setMode(m);
    localStorage.setItem(MODE_KEY, String(m));
  };
  const hint = MODES.find((m) => m.id === mode)?.hint ?? "";

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 工具条：三模式切换 + 模板管理入口 */}
      <div className="flex shrink-0 items-center gap-1">
        <div className="flex items-center gap-0.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5">
          {MODES.map((m) => {
            const Icon = m.icon;
            const active = mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => pick(m.id)}
                title={m.hint}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors duration-150 ${
                  active
                    ? "bg-[var(--accent-dim)] text-[color:var(--accent)]"
                    : "text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                <Icon size={13} />
                {m.label}
              </button>
            );
          })}
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">{hint}</span>
        {defaultTemplate && (
          <span className="shrink-0 text-xs text-[color:var(--text-faint)]" title="新章会自动套用该模板">
            默认模板：{defaultTemplate.name}
          </span>
        )}
        <button
          onClick={() => setTemplatesOpen(true)}
          title="章节模板管理"
          className="flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
        >
          <NotebookText size={13} />
          模板{templateCount > 0 ? ` (${templateCount})` : ""}
        </button>
      </div>

      {/* 内容区：卡片墙/大纲列自滚动，串烧居中排版 */}
      <div className={`min-h-0 flex-1 ${mode === "scrivenings" ? "overflow-y-auto rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-5" : ""}`}>
        {mode === "corkboard" && <Corkboard />}
        {mode === "outliner" && <OutlinerTable />}
        {mode === "scrivenings" && <Scrivenings />}
      </div>

      <TemplateModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
    </div>
  );
}

export function StructureView() {
  return (
    <ViewShell title="结构" wide>
      <StructureWorkspace />
    </ViewShell>
  );
}
