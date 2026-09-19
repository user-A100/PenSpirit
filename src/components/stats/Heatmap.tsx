import { lastNDays } from "../../lib/statsMath";

// 近 6 个月写作热力图（GitHub 式周×日网格，手绘 SVG）。
// 列=周（周一起始），行=周一..周日；强度 5 档透明度按窗口内最大日字数分档。

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const WEEKS = 27; // 189 天 ≈ 近 6 个月
const MONTH_H = 14; // 顶部月份标签行高
const LABEL_W = 14; // 左侧星期标签宽
const OPACITY = [0.16, 0.3, 0.5, 0.72, 0.95];

/** 0=周一 … 6=周日（用本地 Date 构造取星期，无时区陷阱） */
function monIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export interface HeatCell {
  date: string;
  words: number;
  minutes: number;
}

/** data：以今天收尾的全槽位序列（无记录的日子也已补零） */
export function Heatmap({ data }: { data: HeatCell[] }) {
  const slots = data.slice(-WEEKS * 7);
  const lead = slots.length > 0 ? monIndex(slots[0].date) : 0;
  const cells: (HeatCell | null)[] = [...Array<null>(lead).fill(null), ...slots];
  const weeks: (HeatCell | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const maxWords = Math.max(1, ...slots.map((s) => s.words));
  // 5 档：>0 起步，按窗口最大值的 20% 分档封顶
  const levelOf = (w: number) => (w <= 0 ? 0 : Math.min(5, Math.ceil((w / maxWords) * 5)));

  // 月份标签：每列首格所在月变化时标注一次
  const monthLabels: { x: number; text: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((wk, ci) => {
    const first = wk.find((c): c is HeatCell => c != null);
    if (!first) return;
    const m = Number(first.date.slice(5, 7));
    if (m !== lastMonth) {
      monthLabels.push({ x: LABEL_W + ci * STEP, text: `${m}月` });
      lastMonth = m;
    }
  });

  return (
    <div className="overflow-x-auto">
      <svg
        width={LABEL_W + weeks.length * STEP}
        height={MONTH_H + 7 * STEP}
        viewBox={`0 0 ${LABEL_W + weeks.length * STEP} ${MONTH_H + 7 * STEP}`}
        className="block"
        role="img"
        aria-label="近半年每日写作热力图"
      >
        {monthLabels.map((m) => (
          <text key={m.x} x={m.x} y={10} fontSize={9} fill="var(--text-faint)">
            {m.text}
          </text>
        ))}
        {[0, 2, 4].map((r) => (
          <text key={r} x={0} y={MONTH_H + r * STEP + CELL - 1} fontSize={9} fill="var(--text-faint)">
            {["一", "三", "五"][r / 2]}
          </text>
        ))}
        {weeks.map((wk, ci) =>
          wk.map((c, ri) => {
            if (c == null) return null;
            const lvl = levelOf(c.words);
            return (
              <rect
                key={c.date}
                x={LABEL_W + ci * STEP}
                y={MONTH_H + ri * STEP}
                width={CELL}
                height={CELL}
                rx={2}
                fill={lvl === 0 ? "var(--bg-hover)" : "var(--accent)"}
                fillOpacity={lvl === 0 ? 1 : OPACITY[lvl - 1]}
              >
                <title>{`${c.date} · ${c.words.toLocaleString("en-US")} 字 · ${c.minutes} 分钟`}</title>
              </rect>
            );
          }),
        )}
      </svg>
    </div>
  );
}

/** 供调用方生成以 today 收尾的全槽位序列（无记录补零） */
export function heatSlots(
  byDate: Map<string, { words: number; active_minutes: number }>,
  today: string,
): HeatCell[] {
  return lastNDays(WEEKS * 7, today).map((d) => {
    const r = byDate.get(d);
    return { date: d, words: r?.words ?? 0, minutes: r?.active_minutes ?? 0 };
  });
}
