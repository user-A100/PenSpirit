import { describe, expect, it } from "vitest";
import { FORESHADOW_TONE, urgencyOf } from "./urgency";

// 章序为 0 基下标：currentIdx=当前写作位、plantedIdx=埋设章、targetIdx=计划回收章。
// 规则（webnovel-writer foreshadowing.js 移植）：
//   elapsed=current-planted；span=target-planted（≤0 视 1）；score=elapsed/span
//   remaining=target-current；remaining<0→overdue；remaining<=5||score>=2→urgent；否则 active

describe("urgencyOf（webnovel 紧急度模型）", () => {
  it("超期：remaining<0 → overdue", () => {
    const r = urgencyOf({ status: "active", plantedIdx: 0, targetIdx: 2, currentIdx: 5 });
    expect(r.state).toBe("overdue");
    expect(r.remaining).toBe(-3);
    expect(r.score).toBe(2.5); // elapsed 5 / span 2
  });

  it("紧急（remaining≤5 分支）：score<2 证明走的是剩余章数；边界 remaining=5 命中", () => {
    const r = urgencyOf({ status: "active", plantedIdx: 0, targetIdx: 10, currentIdx: 6 });
    expect(r.state).toBe("urgent");
    expect(r.remaining).toBe(4);
    expect(r.score).toBe(0.6);
    expect(urgencyOf({ status: "active", plantedIdx: 0, targetIdx: 7, currentIdx: 2 }).state).toBe("urgent");
  });

  it("紧急（score≥2 分支）：未定回收章悬置过久也该催收（span 视 1，score=elapsed）", () => {
    const r = urgencyOf({ status: "active", plantedIdx: 0, targetIdx: null, currentIdx: 3 });
    expect(r.remaining).toBeNull();
    expect(r.score).toBe(3);
    expect(r.state).toBe("urgent");
  });

  it("活跃：剩余充裕且未超倍率", () => {
    const r = urgencyOf({ status: "active", plantedIdx: 3, targetIdx: 11, currentIdx: 4 });
    expect(r.state).toBe("active");
    expect(r.remaining).toBe(7);
    expect(r.score).toBeCloseTo(0.125);
  });

  it("未定 target：remaining 为 null；悬置不足 2 章仍属活跃", () => {
    expect(urgencyOf({ status: "active", plantedIdx: 0, targetIdx: null, currentIdx: 1 })).toEqual({
      state: "active",
      remaining: null,
      score: 1,
    });
  });

  it("score 分母防护：span≤0 视 1，不产生 Infinity/NaN", () => {
    // target==planted → span=0；target<planted（章序倒挂）→ span<0
    const a = urgencyOf({ status: "active", plantedIdx: 3, targetIdx: 3, currentIdx: 5 });
    expect(a.score).toBe(2);
    expect(Number.isFinite(a.score)).toBe(true);
    const b = urgencyOf({ status: "active", plantedIdx: 5, targetIdx: 3, currentIdx: 7 });
    expect(b.score).toBe(2);
    expect(Number.isFinite(b.score)).toBe(true);
  });

  it("软删埋设章（plantedIdx=-1）：公式不崩，仍按 remaining 判定", () => {
    const r = urgencyOf({ status: "active", plantedIdx: -1, targetIdx: 10, currentIdx: 4 });
    expect(r.state).toBe("active");
    expect(r.remaining).toBe(6);
    expect(r.score).toBeCloseTo(5 / 11);
  });

  it("resolved / dropped 状态直接映射，不参与紧急度", () => {
    expect(urgencyOf({ status: "resolved", plantedIdx: 0, targetIdx: 10, currentIdx: 2 }).state).toBe("resolved");
    expect(urgencyOf({ status: "dropped", plantedIdx: 0, targetIdx: 10, currentIdx: 2 }).state).toBe("dropped");
  });

  it("FORESHADOW_TONE：四态 + 终态的语义色映射", () => {
    expect(FORESHADOW_TONE).toEqual({
      overdue: "red",
      urgent: "amber",
      active: "blue",
      resolved: "green",
      dropped: "neutral",
    });
  });
});
