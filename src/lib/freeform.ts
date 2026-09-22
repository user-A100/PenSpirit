import type { FreeformPos } from "./tauri";

/**
 * 自由摆位 → 阅读顺序（Scrivener Commit 语义：按卡片在墙上的视觉位置重排章节序）。
 * 行主序：按 y 升序扫描，与当前行首 y 差在 rowTolerance 内视为同一行，行内按 x 升序。
 * 未摆过的卡（坐标 0,0）全落在同一桶，靠 sort 稳定性保持原顺序。
 */
export function freeformCommitOrder(
  chapters: { id: number }[],
  positions: FreeformPos[],
  rowTolerance = 60,
): number[] {
  const posById = new Map(positions.map((p) => [p.chapter_id, p]));
  const entries = chapters.map((c) => {
    const p = posById.get(c.id);
    return { id: c.id, x: p?.x ?? 0, y: p?.y ?? 0 };
  });
  const byY = [...entries].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: (typeof entries)[] = [];
  for (const e of byY) {
    const last = rows[rows.length - 1];
    if (last && e.y - last[0].y <= rowTolerance) last.push(e);
    else rows.push([e]);
  }
  return rows.flatMap((row) => [...row].sort((a, b) => a.x - b.x).map((e) => e.id));
}
