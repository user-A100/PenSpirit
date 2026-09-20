import { useEffect, useMemo, useState } from "react";
import { Check, Pause, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Foreshadow } from "../../lib/tauri";
import { useForeshadow } from "../../stores/foreshadow";
import { useWorkspace } from "../../stores/workspace";
import { Badge } from "../ui/Badge";
import { FORESHADOW_TONE, urgencyOf, type ForeshadowState } from "./urgency";

// 伏笔面板（M3-T10，write 视图 dock 的 foreshadow tab）。
// 登记 → 埋设章/计划回收章（未定可选）→ 回收时选章落账；紧急度四态（超期/紧急/活跃 + 已回收/搁置）
// 按 webnovel 紧急度模型排序展示，底部配章轴甘特简版（纯 CSS 线性条 + 当前章竖线）。
// 章序 = chapters 列表下标；软删章不在列表 → -1 显「章已删」。

type Filter = "all" | "urgent" | "overdue" | "active" | "recycled";

const STATE_LABEL: Record<ForeshadowState, string> = {
  overdue: "超期",
  urgent: "紧急",
  active: "活跃",
  resolved: "已回收",
  dropped: "搁置",
};

// 甘特条四态色（与 FORESHADOW_TONE 同语义；蓝色与 Badge blue 同源）
const BAR_COLOR: Record<ForeshadowState, string> = {
  overdue: "var(--danger)",
  urgent: "var(--warning)",
  active: "#3b82f6",
  resolved: "var(--success)",
  dropped: "var(--text-faint)",
};

// 列表排序：超期最靠前，其次紧急、活跃
const SEVERITY: Record<ForeshadowState, number> = { overdue: 0, urgent: 1, active: 2, resolved: 3, dropped: 3 };

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "urgent", label: "紧急" },
  { key: "overdue", label: "超期" },
  { key: "active", label: "活跃" },
  { key: "recycled", label: "已回收" },
];

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 focus:border-[color:var(--accent)]";
const SECTION = "mb-1 text-xs font-medium text-[color:var(--text-secondary)]";
const ICON_BTN =
  "rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)]";

interface Row {
  f: Foreshadow;
  state: ForeshadowState;
  remaining: number | null;
  plantedIdx: number;
  targetIdx: number | null;
  registered: boolean;
}

const isOpenState = (s: ForeshadowState) => s === "overdue" || s === "urgent" || s === "active";

/** 章序 → 展示文案：null=未定；-1=章已删（软删不在 chapters 列表） */
const chLabel = (idx: number | null): string => (idx == null ? "未定" : idx < 0 ? "章已删" : `第${idx + 1}章`);

export function ForeshadowPanel() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const list = useForeshadow((s) => s.list);
  const load = useForeshadow((s) => s.load);
  const upsert = useForeshadow((s) => s.upsert);
  const setStatus = useForeshadow((s) => s.setStatus);
  const remove = useForeshadow((s) => s.remove);

  const [filter, setFilter] = useState<Filter>("all"); // 默认「全部」= 收起已回收
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [planted, setPlanted] = useState(""); // chapter id 字符串
  const [target, setTarget] = useState(""); // ""=未定
  const [note, setNote] = useState("");
  // M4-T5 还债登记：repay 为还债章 id 字符串（""=未登记），overrideNote 为放行理由
  const [repay, setRepay] = useState("");
  const [overrideNote, setOverrideNote] = useState("");
  const [resolvingId, setResolvingId] = useState<number | null>(null);
  const [resolveCh, setResolveCh] = useState("");
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null);

  // 随当前书切换重载
  useEffect(() => {
    void load(currentBookId);
  }, [currentBookId, load]);

  const idxById = useMemo(() => new Map(chapters.map((c, i) => [c.id, i])), [chapters]);
  // 未选中章时以最后一章为写作位
  const currentIdx =
    currentChapterId != null && idxById.has(currentChapterId)
      ? idxById.get(currentChapterId)!
      : Math.max(chapters.length - 1, 0);

  const rows = useMemo<Row[]>(
    () =>
      list
        .map((f): Row => {
          const plantedIdx = idxById.get(f.planted_chapter_id) ?? -1;
          const targetIdx = f.target_chapter_id != null ? (idxById.get(f.target_chapter_id) ?? -1) : null;
          const repayIdx = f.repay_chapter_id != null ? (idxById.get(f.repay_chapter_id) ?? -1) : null;
          const u = urgencyOf({ status: f.status, plantedIdx, targetIdx, currentIdx, repayIdx });
          return { f, state: u.state, remaining: u.remaining, plantedIdx, targetIdx, registered: u.registered };
        })
        .sort((a, b) => SEVERITY[a.state] - SEVERITY[b.state] || a.f.id - b.f.id),
    [list, idxById, currentIdx],
  );

  const countOf = (k: Filter): number => {
    if (k === "all") return rows.filter((r) => isOpenState(r.state)).length;
    if (k === "recycled") return rows.filter((r) => !isOpenState(r.state)).length;
    return rows.filter((r) => r.state === k).length;
  };
  const visible = rows.filter((r) =>
    filter === "all"
      ? isOpenState(r.state)
      : filter === "recycled"
        ? !isOpenState(r.state)
        : r.state === filter,
  );

  /** 表单/回收弹层的默认章：当前章，不在列表（或未选）时退到第一章 */
  const defaultPlanted = () => {
    const id =
      currentChapterId != null && idxById.has(currentChapterId) ? currentChapterId : chapters[0]?.id;
    return id != null ? String(id) : "";
  };

  const openForm = () => {
    setEditingId(null);
    setTitle("");
    setPlanted(defaultPlanted());
    setTarget("");
    setNote("");
    setRepay("");
    setOverrideNote("");
    setFormOpen(true);
  };

  const startEdit = (f: Foreshadow) => {
    setEditingId(f.id);
    setTitle(f.title);
    setPlanted(String(f.planted_chapter_id));
    setTarget(f.target_chapter_id != null ? String(f.target_chapter_id) : "");
    setNote(f.note);
    setRepay(f.repay_chapter_id != null ? String(f.repay_chapter_id) : "");
    setOverrideNote(f.override_note);
    setFormOpen(true);
  };

  const submit = async () => {
    if (currentBookId == null || !title.trim() || planted === "") return;
    const ok = await upsert({
      id: editingId,
      book_id: currentBookId,
      title: title.trim(),
      planted_chapter_id: Number(planted),
      target_chapter_id: target === "" ? null : Number(target),
      note,
      override_note: overrideNote,
      repay_chapter_id: repay === "" ? null : Number(repay),
    });
    if (ok) {
      setFormOpen(false);
      setEditingId(null);
    }
  };

  const confirmResolve = async (id: number) => {
    if (resolveCh === "") return;
    const ok = await setStatus(id, "resolved", Number(resolveCh));
    if (ok) setResolvingId(null);
  };

  // ---- 甘特简版：百分比定位 ----
  const total = chapters.length;
  const pct = (i: number) => Math.min(100, Math.max(0, (i / total) * 100));
  const ganttOn =
    currentBookId != null && total > 0 && visible.length > 0 &&
    (filter === "all" || filter === "overdue" || filter === "urgent");

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {/* 头部：登记 + 待收计数 */}
        <div className="flex items-center gap-2">
          <button
            onClick={openForm}
            disabled={currentBookId == null || chapters.length === 0}
            title={chapters.length === 0 ? "请先创建章节" : "登记一条伏笔"}
            className="flex items-center gap-1 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={12} />
            登记
          </button>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[color:var(--text-faint)]">
            待收 {countOf("all")}
          </span>
        </div>

        {/* 筛选 segmented（默认「全部」收起已回收） */}
        <div className="flex rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-0.5 text-[11px]">
          {FILTERS.map((ft) => (
            <button
              key={ft.key}
              onClick={() => setFilter(ft.key)}
              className={`flex-1 rounded px-1 py-1 transition-colors duration-150 ${
                filter === ft.key
                  ? "bg-[var(--bg-hover)] font-medium text-[color:var(--text-primary)]"
                  : "text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]"
              }`}
            >
              {ft.label} <span className="tabular-nums">{countOf(ft.key)}</span>
            </button>
          ))}
        </div>

        {/* 登记 / 编辑表单 inline 展开 */}
        {formOpen && (
          <div className="flex flex-col gap-1.5 rounded-md border border-[color:var(--border-strong)] bg-[var(--bg-elevated)] p-2">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="伏笔标题（必填）"
              className={INPUT}
            />
            <div className="flex gap-1.5">
              <select
                title="埋设章"
                value={planted}
                onChange={(e) => setPlanted(e.target.value)}
                className={INPUT}
              >
                {chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>{`第${i + 1}章 ${c.title}`}</option>
                ))}
              </select>
              <select
                title="计划回收章"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                className={INPUT}
              >
                <option value="">未定</option>
                {chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>{`第${i + 1}章 ${c.title}`}</option>
                ))}
              </select>
            </div>
            {/* M4-T5 还债登记：登记后紧急度改按还债章倒计时（放行合约） */}
            <div className="flex gap-1.5">
              <select
                title="还债章"
                value={repay}
                onChange={(e) => setRepay(e.target.value)}
                className={INPUT}
              >
                <option value="">未登记还债章</option>
                {chapters.map((c, i) => (
                  <option key={c.id} value={c.id}>{`第${i + 1}章 ${c.title}`}</option>
                ))}
              </select>
              <input
                value={overrideNote}
                onChange={(e) => setOverrideNote(e.target.value)}
                placeholder="放行理由（如：并到第二卷高潮一起收）"
                className={INPUT}
              />
            </div>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="备注（可选）"
              className={`${INPUT} resize-none`}
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                onClick={() => setFormOpen(false)}
                className="rounded px-2 py-1 text-[11px] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
              >
                取消
              </button>
              <button
                onClick={() => void submit()}
                disabled={!title.trim() || planted === ""}
                className="rounded-md bg-[color:var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                保存
              </button>
            </div>
          </div>
        )}

        {/* 列表 */}
        {currentBookId == null ? (
          <div className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-4 text-center text-xs text-[color:var(--text-faint)]">
            请先选择书籍
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-4 text-center text-xs text-[color:var(--text-faint)]">
            {filter === "all" ? "还没有伏笔，点「登记」记一条" : "该筛选下没有伏笔"}
          </div>
        ) : (
          visible.map((r) => {
            const open = isOpenState(r.state);
            return (
              <div key={r.f.id} className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-2">
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-primary)]" title={r.f.title}>
                    {r.f.title}
                  </span>
                  <Badge tone={FORESHADOW_TONE[r.state]} title={`紧急度 ${r.state}`}>
                    {STATE_LABEL[r.state]}
                  </Badge>
                  {r.registered && (
                    <Badge tone="neutral" title={`已登记还债：${r.f.override_note || "未填理由"}`}>
                      已登记还债
                    </Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-[color:var(--text-faint)]">
                  <span>{`${chLabel(r.plantedIdx)}埋 → ${chLabel(r.targetIdx)}收`}</span>
                  {r.remaining != null && (
                    <span title="距计划回收的章数">
                      {r.remaining < 0 ? `超 ${-r.remaining} 章` : `剩 ${r.remaining} 章`}
                    </span>
                  )}
                </div>
                {r.f.note && (
                  <div className="mt-0.5 truncate text-[11px] text-[color:var(--text-faint)]" title={r.f.note}>
                    {r.f.note.split("\n")[0]}
                  </div>
                )}
                {/* 行内操作 */}
                <div className="mt-1 flex items-center gap-0.5">
                  {open && (
                    <>
                      <button
                        title="标记回收"
                        onClick={() => {
                          setResolvingId(r.f.id);
                          setResolveCh(defaultPlanted());
                        }}
                        className={`${ICON_BTN} hover:text-[color:var(--success)]`}
                      >
                        <Check size={12} />
                      </button>
                      <button
                        title="搁置"
                        onClick={() => void setStatus(r.f.id, "dropped", null)}
                        className={`${ICON_BTN} hover:text-[color:var(--warning)]`}
                      >
                        <Pause size={12} />
                      </button>
                    </>
                  )}
                  <button
                    title="编辑"
                    onClick={() => startEdit(r.f)}
                    className={`${ICON_BTN} hover:text-[color:var(--text-secondary)]`}
                  >
                    <Pencil size={12} />
                  </button>
                  {confirmDelId === r.f.id ? (
                    <button
                      title="确认删除"
                      onClick={() => {
                        void remove(r.f.id);
                        setConfirmDelId(null);
                      }}
                      className="rounded bg-[color:var(--danger)]/15 px-1.5 py-0.5 text-[11px] text-[color:var(--danger)] transition-colors duration-150 hover:bg-[color:var(--danger)]/25"
                    >
                      确认
                    </button>
                  ) : (
                    <button
                      title="删除"
                      onClick={() => setConfirmDelId(r.f.id)}
                      className={`${ICON_BTN} hover:text-[color:var(--danger)]`}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
                {/* 标记回收：inline 弹层选章 */}
                {resolvingId === r.f.id && (
                  <div className="mt-1.5 flex items-center gap-1.5 rounded-md bg-[var(--bg-hover)] px-2 py-1.5">
                    <span className="shrink-0 text-[11px] text-[color:var(--text-secondary)]">回收于</span>
                    <select
                      title="回收章"
                      value={resolveCh}
                      onChange={(e) => setResolveCh(e.target.value)}
                      className={`${INPUT} min-w-0 flex-1`}
                    >
                      {chapters.map((c, i) => (
                        <option key={c.id} value={c.id}>{`第${i + 1}章 ${c.title}`}</option>
                      ))}
                    </select>
                    <button
                      title="确认回收"
                      onClick={() => void confirmResolve(r.f.id)}
                      className="shrink-0 rounded-md bg-[color:var(--accent)] px-2 py-1 text-[11px] font-medium text-white transition-opacity duration-150 hover:opacity-90"
                    >
                      确认
                    </button>
                    <button title="取消" onClick={() => setResolvingId(null)} className={`${ICON_BTN} shrink-0`}>
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* 甘特简版：每伏笔一行线性条；仅 全部/超期/紧急 筛选态显示 */}
        {ganttOn && (
          <section>
            <div className={SECTION}>{`章轴 · 当前第 ${currentIdx + 1} 章`}</div>
            <div className="relative flex flex-col gap-1" data-gantt>
              {visible.map((r) => {
                const pPct = pct(Math.max(r.plantedIdx, 0));
                const curPct = pct(Math.max(currentIdx, 0));
                const endPct = r.targetIdx != null ? pct(r.targetIdx) : Math.min(curPct + 10, 100);
                const left = Math.min(pPct, endPct);
                const width = Math.max(endPct - left, 1.5);
                return (
                  <div
                    key={r.f.id}
                    data-gantt-row={r.f.id}
                    title={`${r.f.title}（${STATE_LABEL[r.state]}）`}
                    className="relative h-3.5 overflow-hidden rounded-sm bg-[var(--bg-hover)]"
                  >
                    {r.targetIdx != null ? (
                      <div
                        className="absolute inset-y-0.5 rounded-full opacity-80"
                        style={{ left: `${left}%`, width: `${width}%`, background: BAR_COLOR[r.state] }}
                      />
                    ) : (
                      <>
                        {/* 未定：实段画到当前章，再续 +10% 虚段提示悬置 */}
                        <div
                          className="absolute inset-y-0.5 rounded-full opacity-80"
                          style={{
                            left: `${pPct}%`,
                            width: `${Math.max(curPct - pPct, 1.5)}%`,
                            background: BAR_COLOR[r.state],
                          }}
                        />
                        <div
                          className="absolute inset-y-0.5 rounded-full opacity-50"
                          style={{
                            left: `${curPct}%`,
                            width: `${Math.max(Math.min(10, 100 - curPct), 0)}%`,
                            background: `repeating-linear-gradient(45deg, ${BAR_COLOR[r.state]} 0 3px, transparent 3px 6px)`,
                          }}
                        />
                      </>
                    )}
                    <span className="absolute left-1 top-1/2 z-10 max-w-[65%] -translate-y-1/2 truncate text-[10px] leading-none text-[color:var(--text-primary)]">
                      {r.f.title}
                    </span>
                  </div>
                );
              })}
              {/* 当前章竖线（webnovel markLine 语义） */}
              <div
                data-gantt-mark
                aria-hidden
                title="当前章"
                className="pointer-events-none absolute inset-y-0 z-20 w-px bg-[color:var(--accent)]"
                style={{ left: `${pct(Math.max(currentIdx, 0))}%` }}
              />
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
