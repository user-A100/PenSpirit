// 时间显示（阶段 2C）：库里的消息时间是 SQLite datetime('now')——UTC、不带时区标记。

/** SQLite UTC 时间串 → Date；空串 / 坏值 → null */
export function parseUtc(ts: string | null | undefined): Date | null {
  if (!ts) return null;
  const d = new Date(ts.includes("T") ? ts : `${ts.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 对话里的消息时间：今天只给「时:分」，其它日子带「月-日」，跨年带年 */
export function fmtMsgTime(ts: string | null | undefined, now = new Date()): string {
  const d = parseUtc(ts);
  if (!d) return "";
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const md = `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return d.getFullYear() === now.getFullYear() ? `${md} ${hm}` : `${d.getFullYear()}-${md} ${hm}`;
}

/** 完整本地时间 YYYY-MM-DD HH:MM:SS */
export function fmtFull(ts: string | Date | null | undefined): string {
  const d = ts instanceof Date ? ts : parseUtc(ts);
  if (!d) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
