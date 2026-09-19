import { useEffect } from "react";
import { fmtWords, streaks } from "../../lib/statsMath";
import { HISTORY_DAYS, localDay, useStats } from "../../stores/stats";
import { useWorkspace } from "../../stores/workspace";

// 侧栏底部「今日 N 字」徽章（M2-T11 → M3-T9 升级）。
// 今日字数 = 当前书当日实打差量；🔥连续天数 = 任意书有记录的连续日（今日未写不断签）；
// 日目标 > 0 时叠加 SVG 进度环（stroke-dasharray），达标转绿色庆祝态。

const R = 9;
const CIRC = 2 * Math.PI * R;

export function StatsBadge() {
  const bookId = useWorkspace((s) => s.currentBookId);
  const words = useStats((s) => s.words);
  const activeMinutes = useStats((s) => s.activeMinutes);
  const dailyGoal = useStats((s) => s.dailyGoal);
  const range = useStats((s) => s.range);
  const load = useStats((s) => s.load);
  const loadRange = useStats((s) => s.loadRange);
  const loadDailyGoal = useStats((s) => s.loadDailyGoal);

  useEffect(() => {
    void load(bookId);
    void loadDailyGoal();
    void loadRange(HISTORY_DAYS);
  }, [bookId, load, loadDailyGoal, loadRange]);

  if (bookId == null) return null;

  const today = localDay();
  const activeDates = new Set(
    range.filter((r) => r.words > 0 || r.active_minutes > 0).map((r) => r.date),
  );
  // 本次会话刚写的字数尚未进 range，乐观补进今天，保证环与 🔥 实时
  if (words > 0) activeDates.add(today);
  const streak = streaks([...activeDates], today).current;

  const goal = dailyGoal > 0 ? dailyGoal : 0;
  const pct = goal > 0 ? Math.min(1, words / goal) : 0;
  const achieved = goal > 0 && words >= goal;

  return (
    <div
      data-goal-achieved={goal > 0 ? achieved : undefined}
      title={`今日 ${fmtWords(words)} 字 · 活跃 ${activeMinutes} 分钟${
        goal > 0 ? ` · 日目标 ${fmtWords(goal)} 字${achieved ? " · 已达标 🎉" : ""}` : ""
      }`}
      className="flex items-center justify-center gap-2 px-2 pb-1.5 text-[11px] text-[color:var(--text-faint)]"
    >
      {goal > 0 && (
        <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
          <circle cx="12" cy="12" r={R} fill="none" stroke="var(--border-strong)" strokeWidth="3" />
          <circle
            cx="12"
            cy="12"
            r={R}
            fill="none"
            stroke={achieved ? "var(--success)" : "var(--accent)"}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={`${(pct * CIRC).toFixed(2)} ${CIRC.toFixed(2)}`}
            transform="rotate(-90 12 12)"
          />
          <text
            x="12"
            y="12"
            textAnchor="middle"
            dominantBaseline="central"
            fontSize="8"
            fill={achieved ? "var(--success)" : "var(--text-secondary)"}
          >
            {Math.round(pct * 100)}
          </text>
        </svg>
      )}
      <span>
        今日{" "}
        <span
          style={achieved ? { color: "var(--success)" } : undefined}
          className="text-[color:var(--text-secondary)]"
        >
          {fmtWords(words)}
        </span>{" "}
        字
      </span>
      {streak >= 2 && (
        <span title={`连续写作 ${streak} 天`}>🔥{streak}</span>
      )}
    </div>
  );
}
