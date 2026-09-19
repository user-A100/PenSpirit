import { describe, expect, it } from "vitest";
import { avgActive, fmtWords, lastNDays, median, streaks } from "./statsMath";

// streaks：连续写作天数。current 从 today 起（today 无记录则从 yesterday 起）
// 逐日回溯；longest 为全历史最长连续段。
describe("streaks", () => {
  it("今日有记录：从 today 连续回溯", () => {
    const s = streaks(["2026-09-18", "2026-09-19", "2026-09-20", "2026-09-10"], "2026-09-20");
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it("今日无记录：从昨日数（今日空窗不断签）", () => {
    const s = streaks(["2026-09-17", "2026-09-18"], "2026-09-19");
    expect(s.current).toBe(2);
  });

  it("今日昨日都无记录：current 归零，longest 保留", () => {
    const s = streaks(["2026-09-01", "2026-09-02", "2026-09-03"], "2026-09-20");
    expect(s.current).toBe(0);
    expect(s.longest).toBe(3);
  });

  it("断档：只数最近一段", () => {
    const s = streaks(["2026-09-16", "2026-09-17", "2026-09-19", "2026-09-20"], "2026-09-20");
    expect(s.current).toBe(2);
    expect(s.longest).toBe(2);
  });

  it("跨月边界连续不断（纯字符串日期算术）", () => {
    const s = streaks(["2026-09-30", "2026-10-01"], "2026-10-01");
    expect(s.current).toBe(2);
  });

  it("跨年与闰日（2024 为闰年）", () => {
    expect(streaks(["2025-12-31", "2026-01-01"], "2026-01-01").current).toBe(2);
    expect(streaks(["2024-02-29", "2024-03-01"], "2024-03-01").current).toBe(2);
    // 2023 非闰年：2 月末到 3 月初同样连续
    expect(streaks(["2023-02-28", "2023-03-01"], "2023-03-01").current).toBe(2);
  });

  it("乱序 + 重复日期不影响结果", () => {
    const s = streaks(["2026-09-20", "2026-09-19", "2026-09-19", "2026-09-18"], "2026-09-20");
    expect(s.current).toBe(3);
    expect(s.longest).toBe(3);
  });

  it("空数组归零", () => {
    expect(streaks([], "2026-09-20")).toEqual({ current: 0, longest: 0 });
  });
});

describe("median", () => {
  it("奇数个取正中", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([9, 1, 5])).toBe(5);
  });

  it("偶数个取中间两数均值", () => {
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([1, 2, 3, 4, 5, 6])).toBe(3.5);
  });

  it("单元素与空数组", () => {
    expect(median([7])).toBe(7);
    expect(median([])).toBe(0);
  });
});

describe("avgActive", () => {
  it("只除以活跃日", () => {
    expect(avgActive(100, 4)).toBe(25);
    expect(avgActive(100, 3)).toBeCloseTo(33.333);
  });

  it("0 个活跃日返回 0（不产生 NaN）", () => {
    expect(avgActive(100, 0)).toBe(0);
    expect(avgActive(0, 0)).toBe(0);
  });
});

describe("fmtWords", () => {
  it("万以下 toLocaleString 千分位", () => {
    expect(fmtWords(0)).toBe("0");
    expect(fmtWords(999)).toBe("999");
    expect(fmtWords(1234)).toBe("1,234");
    expect(fmtWords(9999)).toBe("9,999");
  });

  it("≥1e4 以「x.x万」展示", () => {
    expect(fmtWords(10000)).toBe("1.0万");
    expect(fmtWords(12345)).toBe("1.2万");
    expect(fmtWords(123456)).toBe("12.3万");
  });

  it("≥1e8 以「x.x亿」展示", () => {
    expect(fmtWords(100000000)).toBe("1.0亿");
    expect(fmtWords(123456789)).toBe("1.2亿");
  });
});

describe("lastNDays", () => {
  it("升序返回 n 个日期槽位，以 today 收尾", () => {
    expect(lastNDays(3, "2026-09-19")).toEqual(["2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(lastNDays(1, "2026-09-19")).toEqual(["2026-09-19"]);
  });

  it("跨月 / 跨年 / 闰日", () => {
    expect(lastNDays(2, "2026-10-01")).toEqual(["2026-09-30", "2026-10-01"]);
    expect(lastNDays(2, "2026-01-01")).toEqual(["2025-12-31", "2026-01-01"]);
    expect(lastNDays(2, "2024-03-01")).toEqual(["2024-02-29", "2024-03-01"]);
    expect(lastNDays(2, "2023-03-01")).toEqual(["2023-02-28", "2023-03-01"]);
  });

  it("长度恒等于 n", () => {
    expect(lastNDays(30, "2026-09-19")).toHaveLength(30);
  });
});
