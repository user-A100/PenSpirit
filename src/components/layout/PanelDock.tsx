import { useState } from "react";

const TABS = ["大纲", "人物", "伏笔", "碰碰车"] as const;

export function PanelDock() {
  const [tab, setTab] = useState<(typeof TABS)[number]>("大纲");
  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)]">
      <div className="flex border-b" style={{ borderColor: "var(--border)" }}>
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1.5 text-sm ${tab === t ? "border-b-2 text-white" : "text-[var(--fg-dim)]"}`}
            style={tab === t ? { borderColor: "var(--accent)" } : undefined}>{t}</button>
        ))}
      </div>
      <div className="flex flex-1 items-center justify-center text-[var(--fg-dim)]">
        「{tab}」面板将在后续里程碑提供
      </div>
    </div>
  );
}
