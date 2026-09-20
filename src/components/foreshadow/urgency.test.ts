import { describe, expect, it } from "vitest";
import { urgencyOf } from "./urgency";

const base = { status: "active", plantedIdx: 0, currentIdx: 10 };

describe("还债登记（repayIdx）合约", () => {
  it("未登记：过计划回收章即超期", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 10 });
    expect(r.state).toBe("overdue");
    expect(r.registered).toBe(false);
  });

  it("已登记：倒计时改按还债章算，未到不超期", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 10, repayIdx: 20 });
    expect(r.state).not.toBe("overdue");
    expect(r.remaining).toBe(10);
    expect(r.registered).toBe(true);
  });

  it("已登记但过了还债章：重新超期（债没还继续催）", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 25, repayIdx: 20 });
    expect(r.state).toBe("overdue");
  });

  it("还债章临期 ≤5 章进紧急", () => {
    const r = urgencyOf({ ...base, targetIdx: 5, currentIdx: 16, repayIdx: 20 });
    expect(r.state).toBe("urgent");
  });

  it("resolved/dropped 终态不受登记影响", () => {
    expect(urgencyOf({ ...base, status: "resolved", targetIdx: 5, repayIdx: 20 }).state).toBe("resolved");
    expect(urgencyOf({ ...base, status: "dropped", targetIdx: 5, repayIdx: 20 }).state).toBe("dropped");
  });
});
