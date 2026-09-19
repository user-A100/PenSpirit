import { useState } from "react";
import { CircleDot, ListTree, Sparkles, Users, type LucideIcon } from "lucide-react";

interface DockTab {
  name: string;
  icon: LucideIcon;
  empty: string;
}

// 空态说明按规格里程碑标注：人物=M2、大纲/伏笔=M3、碰碰车=M4
const TABS: DockTab[] = [
  { name: "大纲", icon: ListTree, empty: "章节结构与排序，M3 里程碑提供" },
  { name: "人物", icon: Users, empty: "人物图谱与关系网络，M2 里程碑提供" },
  { name: "伏笔", icon: Sparkles, empty: "伏笔登记与回收追踪，M3 里程碑提供" },
  { name: "碰碰车", icon: CircleDot, empty: "灵感碰撞与词组组合，M4 里程碑提供" },
];

export function PanelDock() {
  const [tab, setTab] = useState(TABS[0].name);
  const activeTab = TABS.find((t) => t.name === tab) ?? TABS[0];
  const ActiveIcon = activeTab.icon;

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)]">
      {/* 标签栏 36px：图标 + 文字，激活态底部 2px accent 条 */}
      <div className="flex h-9 shrink-0 border-b border-[color:var(--border-subtle)]">
        {TABS.map((t) => {
          const active = tab === t.name;
          const Icon = t.icon;
          return (
            <button
              key={t.name}
              onClick={() => setTab(t.name)}
              className={`relative flex flex-1 items-center justify-center gap-1.5 text-xs transition-colors duration-150 ${
                active
                  ? "text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              <Icon size={14} />
              {t.name}
              {active && (
                <span
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-0.5 bg-[color:var(--accent)]"
                />
              )}
            </button>
          );
        })}
      </div>

      {/* 空态：大图标 + 功能名 + 一句说明 */}
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        <ActiveIcon size={32} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
        <div className="text-sm text-[color:var(--text-secondary)]">{activeTab.name}</div>
        <div className="text-xs leading-relaxed text-[color:var(--text-faint)]">{activeTab.empty}</div>
      </div>
    </div>
  );
}
