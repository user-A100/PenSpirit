import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarDays, Flame, Gauge, Trophy } from "lucide-react";
import { api, type Book } from "../../lib/tauri";
import { avgActive, fmtWords, lastNDays, median, streaks } from "../../lib/statsMath";
import { HISTORY_DAYS, localDay, useStats } from "../../stores/stats";
import { Badge } from "../ui/Badge";
import { StatCard } from "../ui/StatCard";
import { Heatmap, heatSlots } from "./Heatmap";
import { TrendBars } from "./TrendBars";

// 写作统计面板（M3-T9，dock tab，纵向滚动）。
// 口径：字数为实打差量（粘贴与 AI 采纳不计），时长为活跃分钟（同分钟记一次）；
// 除「每书进度」外全部指标为全书聚合（statsRange bookId=null）。

const SECTION = "mb-1.5 text-xs font-medium text-[color:var(--text-secondary)]";
const INPUT =
  "w-20 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 focus:border-[color:var(--accent)]";

type BookRow = Book & { current: number };

export function StatsPanel() {
  const range = useStats((s) => s.range);
  const dailyGoal = useStats((s) => s.dailyGoal);
  const loadRange = useStats((s) => s.loadRange);
  const loadDailyGoal = useStats((s) => s.loadDailyGoal);
  const setDailyGoal = useStats((s) => s.setDailyGoal);

  const [goalText, setGoalText] = useState("");
  const [books, setBooks] = useState<BookRow[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [targetText, setTargetText] = useState("");

  const refreshBooks = () => loadBooks(setBooks);

  useEffect(() => {
    void loadDailyGoal();
    void loadRange(HISTORY_DAYS);
  }, [loadDailyGoal, loadRange]);

  useEffect(() => {
    setGoalText(String(dailyGoal));
  }, [dailyGoal]);

  useEffect(() => {
    void refreshBooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = localDay();
  const byDate = useMemo(
    () => new Map(range.map((r) => [r.date, r as { words: number; active_minutes: number }])),
    [range],
  );
  // 活跃日 = 当天有任何字数或活跃分钟
  const active = useMemo(
    () => range.filter((r) => r.words > 0 || r.active_minutes > 0),
    [range],
  );
  const st = useMemo(() => streaks(active.map((r) => r.date), today), [active, today]);

  const sumWords = (days: number) =>
    lastNDays(days, today).reduce((n, d) => n + (byDate.get(d)?.words ?? 0), 0);

  const todayWords = byDate.get(today)?.words ?? 0;
  const todayMinutes = byDate.get(today)?.active_minutes ?? 0;
  const week = sumWords(7);
  const month = sumWords(30);
  const total = active.reduce((n, r) => n + r.words, 0);
  const dailyAvg = Math.round(avgActive(total, active.length));
  const med = Math.round(median(lastNDays(30, today).flatMap((d) => {
    const r = byDate.get(d);
    return r && (r.words > 0 || r.active_minutes > 0) ? [r.words] : [];
  })));
  const speed = todayMinutes > 0 ? Math.round(todayWords / todayMinutes) : null;
  const avg30 = month / 30; // 每书「预计完本」用的日均（按日历 30 天）

  const commitGoal = () => {
    const n = Math.max(0, Math.floor(Number(goalText) || 0));
    setGoalText(String(n));
    if (n !== dailyGoal) void setDailyGoal(n);
  };

  const startEdit = (b: BookRow) => {
    setEditingId(b.id);
    setTargetText(b.target_words != null ? String(b.target_words) : "");
  };

  const commitTarget = async (bookId: number) => {
    const n = Math.max(0, Math.floor(Number(targetText) || 0));
    try {
      const updated = await api.booksSetTarget(bookId, n > 0 ? n : null);
      setBooks((prev) =>
        prev.map((b) => (b.id === updated.id ? { ...b, target_words: updated.target_words } : b)),
      );
    } catch {
      // 静默：保存失败保持原显示
    }
    setEditingId(null);
  };

  const eta = (b: BookRow): { text: string; title: string } => {
    if (b.target_words == null || avg30 <= 0) return { text: "—", title: "设置目标并保持日均后估算" };
    if (b.current >= b.target_words) return { text: "已达标", title: "当前字数已达目标" };
    const days = Math.ceil((b.target_words - b.current) / Math.max(avg30, 1));
    const base = new Date();
    const date = localDay(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
    return { text: `预计 ${date}`, title: `按近 30 天日均 ${Math.round(avg30)} 字/天，约 ${days} 天` };
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-2.5">
        {/* 日目标 + 口径说明 */}
        <section>
          <div className="flex items-center gap-2">
            <span className="text-xs text-[color:var(--text-secondary)]">日目标</span>
            <input
              type="number"
              min={0}
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              onBlur={commitGoal}
              onKeyDown={(e) => e.key === "Enter" && commitGoal()}
              className={INPUT}
            />
            <span className="text-xs text-[color:var(--text-faint)]">字/天</span>
            {dailyGoal > 0 ? (
              <Badge tone="purple" title="侧栏徽章会按该目标画进度环">
                {fmtWords(dailyGoal)}
              </Badge>
            ) : (
              <Badge tone="neutral">0 = 关闭</Badge>
            )}
          </div>
          <p className="mt-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1.5 text-[11px] leading-relaxed text-[color:var(--text-faint)]">
            实打差量：粘贴与 AI 采纳不计；时长为活跃分钟（同分钟记一次）
          </p>
        </section>

        {/* 指标卡 */}
        <section>
          <div className={SECTION}>指标 · 全书聚合</div>
          <div className="grid grid-cols-2 gap-3">
            <StatCard label="今日" value={fmtWords(todayWords)} icon={CalendarDays} sub={`${todayMinutes} 活跃分钟`} />
            <StatCard label="本周" value={fmtWords(week)} sub="近 7 天合计" />
            <StatCard label="30 天" value={fmtWords(month)} sub="近 30 天合计" />
            <StatCard label="累计" value={fmtWords(total)} sub="全部历史" />
            <StatCard label="日均" value={fmtWords(dailyAvg)} sub={`按 ${active.length} 个活跃日`} />
            <StatCard label="中位" value={fmtWords(med)} sub="近 30 天日更" />
            <StatCard label="当前连续" value={`${st.current} 天`} icon={Flame} sub="今日未写不断签" />
            <StatCard label="最长连续" value={`${st.longest} 天`} icon={Trophy} sub="全部历史" />
            <StatCard label="活跃天数" value={String(active.length)} icon={CalendarCheck} sub="有记录的日子" />
            <StatCard label="速度" value={speed != null ? `${speed} 字/分` : "—"} icon={Gauge} sub="今日" />
          </div>
        </section>

        {/* 近 30 天趋势 */}
        <section>
          <div className={SECTION}>近 30 天趋势</div>
          <TrendBars
            data={lastNDays(30, today).map((d) => ({ date: d, words: byDate.get(d)?.words ?? 0 }))}
            goal={dailyGoal}
          />
        </section>

        {/* 近半年热力图 */}
        <section>
          <div className={SECTION}>热力图（近半年）</div>
          <Heatmap data={heatSlots(byDate, today)} />
        </section>

        {/* 每书进度 */}
        <section>
          <div className={SECTION}>每书进度</div>
          <div className="flex flex-col gap-2">
            {books.length === 0 && (
              <div className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-3 text-center text-xs text-[color:var(--text-faint)]">
                还没有书
              </div>
            )}
            {books.map((b) => {
              const pct =
                b.target_words != null && b.target_words > 0
                  ? Math.min(100, (b.current / b.target_words) * 100)
                  : 0;
              const e = eta(b);
              return (
                <div key={b.id} className="rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm text-[color:var(--text-primary)]">{b.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-[color:var(--text-faint)]">
                      {fmtWords(b.current)} 字
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-hover)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: `${pct}%`,
                        background: pct >= 100 ? "var(--success)" : "var(--accent)",
                      }}
                    />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-[color:var(--text-faint)]">
                    {editingId === b.id ? (
                      <input
                        type="number"
                        min={0}
                        autoFocus
                        value={targetText}
                        title="目标字数（留空或 0 = 清除目标）"
                        onChange={(e) => setTargetText(e.target.value)}
                        onBlur={() => void commitTarget(b.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitTarget(b.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className={INPUT}
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(b)}
                        title="点击修改目标字数"
                        className="rounded px-1 py-0.5 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
                      >
                        {b.target_words != null ? `目标 ${fmtWords(b.target_words)}` : "目标：未设置"}
                      </button>
                    )}
                    <span title={e.title}>{e.text}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

async function loadBooks(setBooks: (rows: BookRow[]) => void): Promise<void> {
  try {
    const bs = await api.listBooks();
    // 书数量个位数级，逐书取章节字数汇总可接受（不扩 Rust）
    const rows = await Promise.all(
      bs.map(async (b) => {
        try {
          const chs = await api.listChapters(b.id);
          return { ...b, current: chs.reduce((n, c) => n + (c.word_count ?? 0), 0) };
        } catch {
          return { ...b, current: 0 };
        }
      }),
    );
    setBooks(rows);
  } catch {
    // 静默：面板其余部分不受影响
  }
}
