import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { usePlotBlocks } from "../../stores/plotBlocks";
import { useWorkspace } from "../../stores/workspace";
import { Badge, type BadgeTone } from "../ui/Badge";
import type { PlotBlockStatus } from "../../lib/tauri";

// 情节块 dock 面板（write 视图 plot tab，M4）。
// webnovel-writer 情节块三态流转：灵感(idea) → 待用(ready) → 已用(used)。
// 写前攒灵感、写时挑一块「待用」展开成章、用完标记。点击状态徽章循环切换，
// 上/下箭头在当前状态组内换序（sort_key 落库，乐观更新失败回滚）。

const STATUS_META: Record<PlotBlockStatus, { label: string; tone: BadgeTone; next: PlotBlockStatus; hint: string }> = {
  idea: { label: "灵感", tone: "blue", next: "ready", hint: "标记为待用" },
  ready: { label: "待用", tone: "amber", next: "used", hint: "标记为已用" },
  used: { label: "已用", tone: "green", next: "idea", hint: "退回灵感" },
};

const INPUT =
  "w-full resize-none rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

export function PlotBlocksPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const list = usePlotBlocks((s) => s.list);
  const load = usePlotBlocks((s) => s.load);
  const upsert = usePlotBlocks((s) => s.upsert);
  const remove = usePlotBlocks((s) => s.remove);
  const reorder = usePlotBlocks((s) => s.reorder);

  const [draft, setDraft] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null);

  useEffect(() => {
    void load(currentBookId);
  }, [currentBookId, load]);

  const add = async () => {
    if (currentBookId == null || !draft.trim()) return;
    const ok = await upsert({ id: null, book_id: currentBookId, content: draft.trim(), status: "idea", chapter_id: null, sort_key: 0 });
    if (ok) setDraft("");
  };

  const cycleStatus = (b: (typeof list)[number]) => {
    if (currentBookId == null) return;
    const meta = STATUS_META[b.status];
    void upsert({ id: b.id, book_id: b.book_id, content: b.content, status: meta.next, chapter_id: b.chapter_id, sort_key: b.sort_key });
  };

  // 上移/下移：只与相邻块交换（跨状态组也无妨——落库的是全局 sort_key，
  // 展示序后端按 status 分组后再按 sort_key 排）
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= list.length) return;
    const ids = list.map((b) => b.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    void reorder(ids);
  };

  if (currentBookId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[color:var(--text-faint)]">
        <div>先选一本书</div>
        <div className="text-xs">情节块按书归档，攒灵感、挑待用、记已用</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 快速记灵感：Enter 保存，Shift+Enter 换行 */}
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] p-2">
        <textarea
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
          placeholder="记一块情节灵感…（Enter 保存）"
          className={INPUT}
        />
        <div className="mt-1 flex justify-end">
          <button
            onClick={() => void add()}
            disabled={!draft.trim()}
            className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} /> 存为灵感
          </button>
        </div>
      </div>

      {/* 块列表：按状态分组渲染（后端已排好 idea → ready → used） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-[color:var(--text-faint)]">
            <div>还没有情节块</div>
            <div className="text-xs leading-relaxed">
              灵感闪过先丢进来，写章前翻翻「待用」，
              <br />
              哪块展开成章了就点徽章记「已用」
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.map((b, i) => {
              const meta = STATUS_META[b.status];
              return (
                <li
                  key={b.id}
                  className="group flex items-start gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-2"
                >
                  <button
                    onClick={() => cycleStatus(b)}
                    title={`${meta.label} → ${STATUS_META[meta.next].label}（${meta.hint}）`}
                    className="mt-0.5 shrink-0"
                  >
                    <Badge tone={meta.tone}>
                      {meta.label}
                      <ChevronRight size={10} className="ml-0.5 opacity-60" />
                    </Badge>
                  </button>
                  <div className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-[color:var(--text-primary)]">
                    {b.content}
                  </div>
                  <div className="flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                    <div className="flex gap-0.5">
                      <button
                        title="上移"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        title="下移"
                        onClick={() => move(i, 1)}
                        disabled={i === list.length - 1}
                        className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)] disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                    </div>
                    <div className="flex justify-end">
                      {confirmDelId === b.id ? (
                        <span className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              void remove(b.id);
                              setConfirmDelId(null);
                            }}
                            className="rounded bg-[color:var(--danger)]/15 px-1.5 text-[11px] text-[color:var(--danger)] transition-colors duration-150 hover:bg-[color:var(--danger)]/25"
                          >
                            删除
                          </button>
                          <button
                            onClick={() => setConfirmDelId(null)}
                            className="rounded p-0.5 text-[color:var(--text-faint)] hover:bg-[var(--bg-hover)]"
                          >
                            <X size={11} />
                          </button>
                        </span>
                      ) : (
                        <button
                          title="删除"
                          onClick={() => setConfirmDelId(b.id)}
                          className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
