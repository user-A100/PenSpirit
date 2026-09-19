import { useEffect, useRef, useState } from "react";

// 近 30 天字数柱状图（手绘 SVG，零依赖）。
// 关键手法（token-meter）：先量容器实际像素宽，再以 1:1 viewBox 绘制——
// 每个 SVG 单位恰好等于 1px，柱宽/虚线位置不会因视口缩放而拉伸错位。

const PLOT_H = 78; // 柱区高
const AXIS_H = 14; // 底部日期标签高
const PAD_T = 4;
const SVG_H = PAD_T + PLOT_H + AXIS_H;

export function TrendBars({ data, goal }: { data: { date: string; words: number }[]; goal: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const cw = Math.floor(el.clientWidth);
      if (cw > 0) setW(cw);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 测量前（以及测试环境 clientWidth=0）用后备宽度，保证始终可渲染
  const width = Math.max(120, w || 240);
  const n = Math.max(1, data.length);
  const gap = 2;
  const barW = Math.max(1, (width - 2 - gap * (n - 1)) / n);
  // 目标线也要落在图内：maxY 把 goal 一起算上
  const maxWords = Math.max(1, ...data.map((d) => d.words), goal > 0 ? goal : 0);
  const yOf = (v: number) => PAD_T + PLOT_H - Math.round((v / maxWords) * PLOT_H);
  const isToday = (i: number) => i === n - 1;

  return (
    <div ref={wrapRef} className="w-full">
      <svg width={width} height={SVG_H} viewBox={`0 0 ${width} ${SVG_H}`} className="block" role="img" aria-label="近 30 天每日字数柱状图">
        {data.map((d, i) => {
          const h = Math.max(d.words > 0 ? 2 : 1, PAD_T + PLOT_H - yOf(d.words));
          const x = 1 + i * (barW + gap);
          return (
            <rect
              key={d.date}
              x={x}
              y={PAD_T + PLOT_H - h}
              width={barW}
              height={h}
              rx={1}
              fill="var(--accent)"
              fillOpacity={isToday(i) ? 1 : 0.72}
            >
              <title>{`${d.date} · ${d.words.toLocaleString("en-US")} 字`}</title>
            </rect>
          );
        })}
        {goal > 0 && (
          <line
            x1={0}
            x2={width}
            y1={yOf(goal)}
            y2={yOf(goal)}
            stroke="var(--warning)"
            strokeWidth={1}
            strokeDasharray="4 3"
          >
            <title>{`日目标 ${goal.toLocaleString("en-US")} 字`}</title>
          </line>
        )}
        {data.map((d, i) =>
          i === 0 || (i + 1) % 10 === 0 ? (
            <text
              key={d.date}
              x={1 + i * (barW + gap) + barW / 2}
              y={SVG_H - 3}
              fontSize={9}
              fill="var(--text-faint)"
              textAnchor="middle"
            >
              {d.date.slice(5)}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  );
}
