import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { localDay, useStats } from "../../stores/stats";
import { useWorkspace } from "../../stores/workspace";
import type { Book, ChapterMeta, DailyStat } from "../../lib/tauri";
import { Badge } from "../ui/Badge";
import { StatCard } from "../ui/StatCard";

vi.mock("../../lib/tauri", () => ({
  api: {
    settingGet: vi.fn().mockResolvedValue("2000"),
    settingSet: vi.fn().mockResolvedValue(undefined),
    statsRange: vi.fn().mockResolvedValue([]),
    statsToday: vi.fn(),
    statsAdd: vi.fn().mockResolvedValue(undefined),
    listBooks: vi.fn().mockResolvedValue([]),
    listChapters: vi.fn().mockResolvedValue([]),
    booksSetTarget: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { StatsBadge } from "../sidebar/StatsBadge";
import { StatsPanel } from "./StatsPanel";

// ---- 夹具：以真实「今天」为锚做日期偏移，跨月/闰年由 Date 自行处理 ----
const TODAY = localDay();
function day(offset: number): string {
  const b = new Date();
  return localDay(new Date(b.getFullYear(), b.getMonth(), b.getDate() - offset));
}
function stat(off: number, words: number, minutes: number): DailyStat {
  return { date: day(off), words, active_minutes: minutes };
}

// 当前连续 3 天（0/1/2，第 3 天断档）；历史最长 4 天（9-12）；40 天前一条旧记录
const RANGE: DailyStat[] = [
  stat(0, 1200, 60),
  stat(1, 800, 40),
  stat(2, 400, 20),
  stat(4, 600, 30),
  stat(9, 1000, 50),
  stat(10, 100, 10),
  stat(11, 200, 10),
  stat(12, 300, 10),
  stat(40, 500, 0),
];

const BOOK1: Book = { id: 1, slug: "xianlu", title: "仙路", created_at: "", updated_at: "", target_words: 100000 };
const BOOK2: Book = { id: 2, slug: "wuxiang", title: "无目标之书", created_at: "", updated_at: "", target_words: null };
const CHS_1: ChapterMeta[] = [
  { id: 11, book_id: 1, file_path: "", title: "一", sort_key: 1, word_count: 15000, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
  { id: 12, book_id: 1, file_path: "", title: "二", sort_key: 2, word_count: 5000, created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null, target_words: null },
];

function resetStore() {
  useStats.setState({
    bookId: null, day: "", words: 0, activeMinutes: 0, dailyGoal: 0, range: [],
  });
  useWorkspace.setState({ currentBookId: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  (api.settingGet as ReturnType<typeof vi.fn>).mockResolvedValue("2000");
  (api.statsRange as ReturnType<typeof vi.fn>).mockResolvedValue(RANGE);
  (api.listBooks as ReturnType<typeof vi.fn>).mockResolvedValue([BOOK1, BOOK2]);
  (api.listChapters as ReturnType<typeof vi.fn>).mockImplementation((bookId: number) =>
    Promise.resolve(bookId === 1 ? CHS_1 : []),
  );
  resetStore();
});

describe("Badge / StatCard 基础渲染", () => {
  it("Badge 六色 tone 均可渲染并保留语义文案", () => {
    const tones = ["neutral", "blue", "green", "amber", "red", "purple"] as const;
    render(
      <div>
        {tones.map((t) => (
          <Badge key={t} tone={t}>
            {t}
          </Badge>
        ))}
      </div>,
    );
    for (const t of tones) {
      expect(screen.getByText(t)).toBeInTheDocument();
      expect(screen.getByText(t).dataset.tone).toBe(t);
    }
  });

  it("StatCard 渲染 label/value/sub 三层结构", () => {
    render(<StatCard label="今日" value="1,200" sub="全书合计" />);
    expect(screen.getByText("今日")).toBeInTheDocument();
    expect(screen.getByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("全书合计")).toBeInTheDocument();
  });
});

describe("StatsPanel", () => {
  it("指标卡出数：今日/本周/30天/累计/日均/中位/连续/活跃天数/速度", async () => {
    render(<StatsPanel />);

    // 本周(近7天)=3000；30天=4600；累计=5100；日均=round(5100/9)=567；中位(30天)=500；速度=1200/60
    expect(await screen.findByText("1,200")).toBeInTheDocument();
    expect(screen.getByText("3,000")).toBeInTheDocument();
    expect(screen.getByText("4,600")).toBeInTheDocument();
    expect(screen.getByText("5,100")).toBeInTheDocument();
    expect(screen.getByText("567")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
    expect(screen.getByText("3 天")).toBeInTheDocument(); // 当前连续 🔥
    expect(screen.getByText("4 天")).toBeInTheDocument(); // 最长连续 🏆
    expect(screen.getByText("9")).toBeInTheDocument(); // 活跃天数
    expect(screen.getByText("20 字/分")).toBeInTheDocument(); // 速度
  });

  it("口径说明卡文案存在（统计透明化）", async () => {
    render(<StatsPanel />);
    expect(
      await screen.findByText("实打差量：粘贴与 AI 采纳不计；时长为活跃分钟（同分钟记一次）"),
    ).toBeInTheDocument();
  });

  it("日目标从 settings KV 读入，修改后写回（0=关闭）", async () => {
    render(<StatsPanel />);
    const input = await screen.findByDisplayValue("2000");
    expect(api.settingGet).toHaveBeenCalledWith("stats:dailyGoal");

    fireEvent.change(input, { target: { value: "3000" } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(api.settingSet).toHaveBeenCalledWith("stats:dailyGoal", "3000"),
    );
    expect(await screen.findByDisplayValue("3000")).toBeInTheDocument();
  });

  it("每书进度：字数汇总/进度信息/预计完本；无目标或日均 0 显「—」", async () => {
    render(<StatsPanel />);

    expect(await screen.findByText("仙路")).toBeInTheDocument();
    expect(screen.getByText("无目标之书")).toBeInTheDocument();
    expect(screen.getByText("2.0万 字")).toBeInTheDocument(); // 15000 + 5000
    expect(screen.getByText("目标 10.0万")).toBeInTheDocument();

    // 近 30 天日均 = 4600/30 ≈ 153.3 → (100000-20000)/153.3 → ceil = 522 天后完本
    const b = new Date();
    const eta = localDay(new Date(b.getFullYear(), b.getMonth(), b.getDate() + 522));
    expect(screen.getByText(`预计 ${eta}`)).toBeInTheDocument();
    // 无目标的书显「—」
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("点击目标数字弹 inline 输入，回车提交 booksSetTarget", async () => {
    (api.booksSetTarget as ReturnType<typeof vi.fn>).mockResolvedValue({ ...BOOK1, target_words: 200000 });
    render(<StatsPanel />);

    // 第一本书（仙路）的目标按钮；两本书都有该按钮，取第一个
    fireEvent.click((await screen.findAllByTitle("点击修改目标字数"))[0]);
    const input = await screen.findByDisplayValue("100000");

    fireEvent.change(input, { target: { value: "200000" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.booksSetTarget).toHaveBeenCalledWith(1, 200000));
    expect(await screen.findByText("目标 20.0万")).toBeInTheDocument();
  });
});

describe("StatsBadge 日目标环", () => {
  it("达标态：环形进度满、data-goal-achieved=true、数字变绿", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: TODAY, book_id: 1, words: 2500, active_minutes: 60,
    });
    useWorkspace.setState({ currentBookId: 1 });
    const { container } = render(<StatsBadge />);

    await waitFor(() => expect(useStats.getState().words).toBe(2500));
    await waitFor(() => expect(useStats.getState().dailyGoal).toBe(2000));
    await waitFor(() => expect(useStats.getState().range.length).toBe(RANGE.length));

    const el = container.querySelector<HTMLElement>('[data-goal-achieved="true"]');
    expect(el).not.toBeNull();
    expect(el!.title).toContain("已达标");
    expect(screen.getByText("2,500")).toBeInTheDocument();
    expect(screen.getByText("🔥3")).toBeInTheDocument(); // 连续天数来自 range
  });

  it("未达标态：data-goal-achieved=false，仍显示进度环", async () => {
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: TODAY, book_id: 1, words: 800, active_minutes: 30,
    });
    useWorkspace.setState({ currentBookId: 1 });
    const { container } = render(<StatsBadge />);

    await waitFor(() =>
      expect(container.querySelector('[data-goal-achieved="false"]')).not.toBeNull(),
    );
    expect(screen.getByText("800")).toBeInTheDocument();
  });

  it("日目标为 0（关闭）时不画环", async () => {
    (api.settingGet as ReturnType<typeof vi.fn>).mockResolvedValue("0");
    (api.statsToday as ReturnType<typeof vi.fn>).mockResolvedValue({
      date: TODAY, book_id: 1, words: 800, active_minutes: 30,
    });
    useWorkspace.setState({ currentBookId: 1 });
    const { container } = render(<StatsBadge />);

    await waitFor(() => expect(useStats.getState().dailyGoal).toBe(0));
    await waitFor(() => expect(screen.getByText("800")).toBeInTheDocument());
    expect(container.querySelector("[data-goal-achieved]")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
