// 写作统计纯函数（M3-T9）。全部基于 YYYY-MM-DD 字符串做整数日期算术
// （Howard Hinnant days_from_civil 公式），不经过 Date 解析，天然免疫时区/
// 跨月/闰年问题；面板与徽章共享同一套口径。

/** 公历日期 → 相对 1970-01-01 的天数（纯整数，无时区参与） */
function toDayNumber(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const yy = y - (m <= 2 ? 1 : 0);
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400; // [0,399]
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 天数 → 公历日期串（toDayNumber 的逆） */
function fromDayNumber(z: number): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return `${y + (m <= 2 ? 1 : 0)}-${p2(m)}-${p2(d)}`;
}

/** 日期 +n 天（n 可为负） */
function addDays(day: string, n: number): string {
  return fromDayNumber(toDayNumber(day) + n);
}

/**
 * 连续写作天数。
 * current：从 today 起（today 无记录则从 yesterday 起）逐日 -1 回溯计数——
 *   今天还没写不算断签；today 与 yesterday 都空则归零。
 * longest：排序去重后相邻恰好差 1 天的连续段长度最大值（全历史）。
 */
export function streaks(dates: string[], today: string): { current: number; longest: number } {
  const set = new Set(dates);
  let cursor = set.has(today) ? today : addDays(today, -1);
  let current = 0;
  while (set.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  const sorted = [...set].sort();
  let longest = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const n = toDayNumber(d);
    run = prev !== null && n - prev === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = n;
  }
  return { current, longest };
}

/** 中位数；偶数个取中间两数均值，空数组回 0 */
export function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 日均字数（分母只算活跃日）；活跃日为 0 时回 0，不产生 NaN */
export function avgActive(total: number, activeDays: number): number {
  return activeDays > 0 ? total / activeDays : 0;
}

/** 字数展示：≥1亿→x.x亿；≥1万→x.x万；否则千分位。固定 en-US 保证测试确定性 */
export function fmtWords(n: number): string {
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;
  return n.toLocaleString("en-US");
}

/** 以 today 收尾的 n 个升序日期槽位（图表/热力图补零用） */
export function lastNDays(n: number, today: string): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(addDays(today, -i));
  return out;
}
