import { useMemo, useState } from "react";
import { create } from "zustand";
import { Search } from "lucide-react";
import { formatCombo, getCommands } from "../../lib/commands";
import { Modal } from "./Modal";

// 快捷键速查（阶段 4，Ctrl+/）：数据来自命令注册表——注册了快捷键的命令自动出现在这里，
// 外加少量编辑器内置键（不走命令中枢）。可搜索（命令名 / 键位 / 分类）。

export const useShortcutSheet = create<{ open: boolean; toggle: () => void; close: () => void }>((set) => ({
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  close: () => set({ open: false }),
}));

/** 编辑器 / 浮层里的内置键（不在命令注册表里） */
const BUILTIN: { category: string; title: string; keys: string[] }[] = [
  { category: "编辑", title: "撤销 / 重做", keys: ["Ctrl+Z", "Ctrl+Shift+Z"] },
  { category: "编辑", title: "加粗 / 斜体", keys: ["Ctrl+B", "Ctrl+I"] },
  { category: "AI", title: "接受幽灵补全的灰字", keys: ["Tab"] },
  { category: "AI", title: "就地改写 / 续写浮条：应用 · 丢弃", keys: ["Enter", "Esc"] },
  { category: "AI", title: "输入框：发送 · 换行 · 召回上一问", keys: ["Enter", "Shift+Enter", "↑"] },
  { category: "AI", title: "输入框：命令 · 引用", keys: ["/", "@"] },
  { category: "导航", title: "关闭弹层 / 菜单", keys: ["Esc"] },
];

export function ShortcutSheet() {
  const open = useShortcutSheet((s) => s.open);
  const close = useShortcutSheet((s) => s.close);
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    if (!open) return [];
    const rows = [
      ...getCommands()
        .filter((c) => c.keys && c.keys.length > 0)
        .map((c) => ({ category: c.category ?? "其他", title: c.title, keys: c.keys!.map(formatCombo) })),
      ...BUILTIN,
    ];
    const needle = q.trim().toLowerCase();
    const hit = rows.filter((r) => !needle || `${r.category} ${r.title} ${r.keys.join(" ")}`.toLowerCase().includes(needle));
    const order = ["导航", "视图", "章节", "编辑", "AI", "其他"];
    const by = new Map<string, typeof hit>();
    for (const r of hit) by.set(r.category, [...(by.get(r.category) ?? []), r]);
    return [...by.entries()].sort((a, b) => (order.indexOf(a[0]) + 99) % 99 - ((order.indexOf(b[0]) + 99) % 99));
  }, [open, q]);
  if (!open) return null;
  return (
    <Modal open onClose={close} title="快捷键" widthClass="max-w-2xl" testId="shortcut-sheet">
      <div className="flex min-h-0 flex-1 flex-col px-5 pb-4 pt-2">
        <label className="mb-3 flex items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--fill-element)] px-2">
          <Search size={13} className="text-[color:var(--text-faint)]" />
          <input
            autoFocus
            value={q}
            aria-label="搜索快捷键"
            placeholder="搜索命令或键位，如「分屏」「Alt」"
            onChange={(e) => setQ(e.target.value)}
            className="h-8 min-w-0 flex-1 bg-transparent text-ui text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
        </label>
        <div className="min-h-0 flex-1 columns-1 gap-6 overflow-y-auto sm:columns-2">
          {groups.map(([cat, rows]) => (
            <section key={cat} className="mb-4 break-inside-avoid" data-shortcut-group={cat}>
              <h3 className="mb-1.5 text-2xs font-medium tracking-wide text-[color:var(--text-faint)]">{cat}</h3>
              <ul className="space-y-1">
                {rows.map((r) => (
                  <li key={`${r.title}-${r.keys.join()}`} className="flex items-center gap-2 text-xs" data-shortcut-row="">
                    <span className="min-w-0 flex-1 text-[color:var(--text-secondary)]">{r.title}</span>
                    <span className="flex shrink-0 gap-1">
                      {r.keys.map((k) => (
                        <kbd key={k} className="rounded-[4px] px-1.5 py-px font-sans text-2xs text-[color:var(--text-primary)] [box-shadow:inset_0_0_0_1px_var(--hairline)]">
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {groups.length === 0 && <div className="text-xs text-[color:var(--text-faint)]">没有匹配的快捷键</div>}
        </div>
      </div>
    </Modal>
  );
}
