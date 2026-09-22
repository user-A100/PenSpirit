import { describe, expect, it } from "vitest";
import { freeformCommitOrder } from "./freeform";
import type { FreeformPos } from "./tauri";

const pos = (id: number, x: number, y: number): FreeformPos => ({ chapter_id: id, x, y });
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("freeformCommitOrder 自由摆位落序", () => {
  it("行主序：先按行（y 桶）后按列（x）", () => {
    // 1(0,0) 2(200,10) 同行；3(10,150) 4(210,160) 第二行
    const out = freeformCommitOrder(ids(4), [pos(1, 0, 0), pos(2, 200, 10), pos(3, 10, 150), pos(4, 210, 160)]);
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it("行内 x 乱序时按 x 重排，行间按 y", () => {
    const out = freeformCommitOrder(ids(3), [pos(1, 100, 200), pos(2, 0, 0), pos(3, 50, 200)]);
    expect(out).toEqual([2, 3, 1]);
  });

  it("容差归行：y 差在阈值内视为同一行（以行首为锚）", () => {
    // y=0 与 y=50 同行（≤60）；y=100 距行首 0 超容差 → 另起一行
    const out = freeformCommitOrder(ids(3), [pos(1, 0, 0), pos(2, 10, 50), pos(3, 20, 100)]);
    expect(out).toEqual([1, 2, 3]);
    expect(freeformCommitOrder(ids(1), [pos(1, 0, 0)], 200)).toEqual([1]);
  });

  it("没给坐标的章按 0,0 参与，同坐标靠稳定排序保持原序", () => {
    const out = freeformCommitOrder(ids(3), []);
    expect(out).toEqual([1, 2, 3]);
    // 只有 1 挪远：同 y=0 行内 2、3 x 并列 → 稳定保持 2 在 3 前
    const moved = freeformCommitOrder(ids(3), [pos(1, 500, 0)]);
    expect(moved).toEqual([2, 3, 1]);
  });

  it("positions 里多余的章（其他书/已删）不影响结果", () => {
    const out = freeformCommitOrder(ids(2), [pos(1, 0, 0), pos(99, 50, 50)]);
    expect(out).toEqual([1, 2]);
  });
});
