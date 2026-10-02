import { describe, expect, it } from "vitest";
import { applyMove, dropIndex, mergeSubsetOrder, nudge } from "./binderDnd";

const rows = [
  { id: 1, top: 0, bottom: 30 },
  { id: 2, top: 32, bottom: 62 },
  { id: 3, top: 64, bottom: 94 },
];

describe("binderDnd", () => {
  it("dropIndex：上半插前、下半插后", () => {
    expect(dropIndex(rows, 5)).toBe(0);
    expect(dropIndex(rows, 20)).toBe(1);
    expect(dropIndex(rows, 50)).toBe(2);
    expect(dropIndex(rows, 90)).toBe(3);
  });

  it("applyMove：单个下移 / 上移 / 原地不动", () => {
    expect(applyMove([1, 2, 3, 4], [1], 3)).toEqual([2, 3, 1, 4]);
    expect(applyMove([1, 2, 3, 4], [4], 0)).toEqual([4, 1, 2, 3]);
    const same = [1, 2, 3];
    expect(applyMove(same, [2], 1)).toBe(same);
    expect(applyMove(same, [2], 2)).toBe(same);
  });

  it("applyMove：不连续多选聚拢到落点并保持相对顺序", () => {
    expect(applyMove([1, 2, 3, 4, 5], [1, 4], 3)).toEqual([2, 3, 1, 4, 5]);
    expect(applyMove([1, 2, 3, 4, 5], [2, 5], 0)).toEqual([2, 5, 1, 3, 4]);
  });

  it("nudge：整体上移/下移一格，边界不动", () => {
    expect(nudge([1, 2, 3, 4], [2, 3], -1)).toEqual([2, 3, 1, 4]);
    expect(nudge([1, 2, 3, 4], [2, 3], 1)).toEqual([1, 4, 2, 3]);
    const top = [1, 2, 3];
    expect(nudge(top, [1], -1)).toBe(top);
  });

  it("mergeSubsetOrder：子集重排写回全序", () => {
    expect(mergeSubsetOrder([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
  });
});
