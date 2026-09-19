import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDay, localMinute, useStats } from "./stats";

vi.mock("../lib/tauri", () => ({
  api: { statsToday: vi.fn(), statsAdd: vi.fn() },
}));

import { api } from "../lib/tauri";

const TODAY = { date: localDay(), book_id: 1, words: 100, active_minutes: 5 };

describe("stats store 时间口径", () => {
  it("localDay 补零到 YYYY-MM-DD（与后端 date('now','localtime') 同口径）", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("localMinute 精确到分钟", () => {
    expect(localMinute(new Date(2026, 8, 19, 9, 7))).toBe("2026-09-19 09:07");
  });
});

describe("stats store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStats.setState({ bookId: null, day: "", words: 0, activeMinutes: 0 });
  });

  it("load 取当日统计", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue(TODAY);
    await useStats.getState().load(1);

    expect(api.statsToday).toHaveBeenCalledWith(1);
    expect(useStats.getState().words).toBe(100);
    expect(useStats.getState().activeMinutes).toBe(5);
    expect(useStats.getState().day).toBe(TODAY.date);
  });

  it("没有书时归零", async () => {
    useStats.setState({ words: 50 });
    await useStats.getState().load(null);
    expect(useStats.getState().words).toBe(0);
    expect(api.statsToday).not.toHaveBeenCalled();
  });

  it("record 乐观累加并落库", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue(TODAY);
    (api.statsAdd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await useStats.getState().load(1);

    await useStats.getState().record(1, 12, true);

    expect(useStats.getState().words).toBe(112);
    expect(useStats.getState().activeMinutes).toBe(6);
    expect(api.statsAdd).toHaveBeenCalledWith(1, 12, true);
  });

  it("删除造成的负增量同样累加", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue(TODAY);
    (api.statsAdd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    await useStats.getState().load(1);

    await useStats.getState().record(1, -30, false);
    expect(useStats.getState().words).toBe(70);
  });

  it("换书时先重新拉取再叠加，避免把上一本的字数算进来", async () => {
    useStats.setState({ bookId: 2, day: localDay(), words: 999, activeMinutes: 9 });
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...TODAY, book_id: 1, words: 10, active_minutes: 2,
    });
    (api.statsAdd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useStats.getState().record(1, 5, false);

    expect(api.statsToday).toHaveBeenCalledWith(1);
    expect(useStats.getState().words).toBe(15); // 服务端 10 + 本次 5，而不是上一本的 999
    expect(useStats.getState().activeMinutes).toBe(2);
  });

  it("跨 0 点后按新的一天重新拉取", async () => {
    useStats.setState({ bookId: 1, day: "2000-01-01", words: 888 });
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue({ ...TODAY, words: 3 });
    (api.statsAdd as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useStats.getState().record(1, 7, false);

    expect(api.statsToday).toHaveBeenCalledWith(1);
    expect(useStats.getState().words).toBe(10);
    expect(useStats.getState().day).toBe(localDay());
  });

  it("落库失败不抛错、不回滚（统计是尽力而为）", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue(TODAY);
    await useStats.getState().load(1);
    (api.statsAdd as ReturnType<typeof vi.fn>).mockRejectedValue("db locked");

    await expect(useStats.getState().record(1, 8, false)).resolves.toBeUndefined();
    expect(useStats.getState().words).toBe(108);
  });
});
