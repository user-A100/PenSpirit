import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta, Foreshadow } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

vi.mock("../../lib/tauri", () => ({
  api: {
    foreshadowsList: vi.fn(),
    foreshadowUpsert: vi.fn(),
    foreshadowSetStatus: vi.fn(),
    foreshadowDelete: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { useForeshadow } from "../../stores/foreshadow";
import { ForeshadowPanel } from "./ForeshadowPanel";

// ---- 夹具：12 章（id 11..22，下标 0..11），当前写第 5 章（id 15，下标 4）----
const NUMS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"];
const CHS: ChapterMeta[] = NUMS.map((title, i) => ({
  id: 11 + i,
  book_id: 1,
  file_path: "",
  title,
  sort_key: i + 1,
  word_count: 0,
  created_at: "",
  updated_at: "",
}));

function fs(p: Partial<Foreshadow> & Pick<Foreshadow, "id" | "title">): Foreshadow {
  return {
    book_id: 1,
    planted_chapter_id: 11,
    target_chapter_id: null,
    status: "active",
    note: "",
    created_at: "2026-09-01 00:00:00",
    resolved_chapter_id: null,
    override_note: "",
    repay_chapter_id: null,
    ...p,
  };
}

// 101 紧急(剩1) / 102 超期 / 103 活跃 / 104 resolved / 105 dropped /
// 106 紧急(未定悬置 score=3) / 107 紧急(埋设章 999 已软删 → -1)
const LIST: Foreshadow[] = [
  fs({ id: 101, title: "玉佩之谜", planted_chapter_id: 11, target_chapter_id: 16, note: "开篇玉佩特写\n后续认亲" }),
  fs({ id: 102, title: "黑袍人", planted_chapter_id: 11, target_chapter_id: 13, note: "酒馆蒙面人" }),
  fs({ id: 103, title: "师姐的伞", planted_chapter_id: 14, target_chapter_id: 22 }),
  fs({
    id: 104, title: "师父遗言", planted_chapter_id: 11, target_chapter_id: 15,
    status: "resolved", resolved_chapter_id: 15,
  }),
  fs({ id: 105, title: "弃用的梗", planted_chapter_id: 12, status: "dropped" }),
  fs({ id: 106, title: "夜半钟声", planted_chapter_id: 12, note: "钟响三次" }),
  fs({ id: 107, title: "旧线索", planted_chapter_id: 999, target_chapter_id: 18 }),
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.foreshadowsList as ReturnType<typeof vi.fn>).mockResolvedValue(LIST);
  (api.foreshadowUpsert as ReturnType<typeof vi.fn>).mockResolvedValue(LIST[0]);
  (api.foreshadowSetStatus as ReturnType<typeof vi.fn>).mockResolvedValue(LIST[0]);
  (api.foreshadowDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  useWorkspace.setState({
    books: [], chapters: CHS, currentBookId: 1, currentChapterId: 15, chapterContent: null,
  });
  useForeshadow.setState({ bookId: null, list: [] });
});

describe("ForeshadowPanel", () => {
  it("列表渲染：四态徽章、章序文案（未定/章已删）、note 首行、剩余章数；已回收默认收起", async () => {
    const { container } = render(<ForeshadowPanel />);

    // 标题出现在两处：列表行 + 甘特标签
    expect(await screen.findAllByText("玉佩之谜")).toHaveLength(2);
    for (const t of ["黑袍人", "师姐的伞", "夜半钟声", "旧线索"]) {
      expect(screen.getAllByText(t)).toHaveLength(2);
    }
    // resolved/dropped 默认收起（webnovel 同款）
    expect(screen.queryByText("师父遗言")).not.toBeInTheDocument();
    expect(screen.queryByText("弃用的梗")).not.toBeInTheDocument();

    // 徽章：紧急 3 条（玉佩/夜半钟声/旧线索）、超期 1、活跃 1——按 tone 定位并验证文案
    const badgeTexts = (tone: string) =>
      Array.from(container.querySelectorAll<HTMLElement>(`[data-tone="${tone}"]`)).map((el) => el.textContent);
    expect(badgeTexts("amber")).toEqual(["紧急", "紧急", "紧急"]);
    expect(badgeTexts("red")).toEqual(["超期"]);
    expect(badgeTexts("blue")).toEqual(["活跃"]);

    // 章序：第X章埋 → 第Y章收；未定 / 章已删特判
    expect(screen.getByText("第1章埋 → 第3章收")).toBeInTheDocument(); // 黑袍人
    expect(screen.getByText("第2章埋 → 未定收")).toBeInTheDocument(); // 夜半钟声
    expect(screen.getByText("章已删埋 → 第8章收")).toBeInTheDocument(); // 旧线索

    // note 首行 + 剩余/超期章数
    expect(screen.getByText("开篇玉佩特写")).toBeInTheDocument();
    expect(screen.getByText("剩 1 章")).toBeInTheDocument(); // 玉佩之谜 remaining=1
    expect(screen.getByText("超 2 章")).toBeInTheDocument(); // 黑袍人 remaining=-2

    // 甘特简版：全部态显示 5 行 + 当前章竖线在 4/12 处
    expect(container.querySelectorAll("[data-gantt-row]")).toHaveLength(5);
    const mark = container.querySelector<HTMLElement>("[data-gantt-mark]");
    expect(mark).not.toBeNull();
    expect(parseFloat(mark!.style.left)).toBeCloseTo((4 / 12) * 100, 1);
  });

  it("筛选：超期只留黑袍人；已回收态显示 resolved/dropped 且甘特收起", async () => {
    const { container } = render(<ForeshadowPanel />);
    await screen.findAllByText("玉佩之谜");

    fireEvent.click(screen.getByRole("button", { name: "超期 1" }));
    expect(screen.getAllByText("黑袍人")).toHaveLength(2); // 列表行 + 甘特标签
    expect(screen.queryByText("玉佩之谜")).not.toBeInTheDocument();
    expect(container.querySelectorAll("[data-gantt-row]")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "已回收 2" }));
    expect(screen.getByText("师父遗言")).toBeInTheDocument();
    expect(screen.getByText("弃用的梗")).toBeInTheDocument();
    expect(screen.queryByText("黑袍人")).not.toBeInTheDocument();
    expect(container.querySelector("[data-gantt]")).toBeNull(); // 甘特仅全部/超期/紧急态
  });

  it("登记：表单默认当前章，提交调 foreshadowUpsert 并刷新列表", async () => {
    render(<ForeshadowPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "登记" }));

    fireEvent.change(screen.getByPlaceholderText("伏笔标题（必填）"), { target: { value: "灯火阑珊" } });
    const planted = screen.getByTitle("埋设章");
    expect(planted).toHaveDisplayValue("第5章 五"); // 默认埋在当前章
    fireEvent.change(planted, { target: { value: "11" } });
    const target = screen.getByTitle("计划回收章");
    expect(target).toHaveDisplayValue("未定");
    fireEvent.change(target, { target: { value: "19" } }); // 第9章
    fireEvent.change(screen.getByPlaceholderText("备注（可选）"), { target: { value: "长街的灯笼" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(api.foreshadowUpsert).toHaveBeenCalledWith({
        id: null,
        book_id: 1,
        title: "灯火阑珊",
        planted_chapter_id: 11,
        target_chapter_id: 19,
        note: "长街的灯笼",
        override_note: "",
        repay_chapter_id: null,
      }),
    );
    await waitFor(() => expect(api.foreshadowsList).toHaveBeenCalledTimes(2)); // 初次 + 提交后刷新
    await waitFor(() => expect(screen.queryByPlaceholderText("伏笔标题（必填）")).toBeNull()); // 表单收起
  });

  it("标记回收：行内弹章选择（默认当前章），确认调 foreshadowSetStatus", async () => {
    render(<ForeshadowPanel />);
    // 超期排最前 → 第一个「标记回收」属于黑袍人(102)
    fireEvent.click((await screen.findAllByTitle("标记回收"))[0]);

    const sel = screen.getByTitle("回收章");
    expect(sel).toHaveDisplayValue("第5章 五");
    fireEvent.change(sel, { target: { value: "16" } }); // 第6章
    fireEvent.click(screen.getByTitle("确认回收"));

    await waitFor(() => expect(api.foreshadowSetStatus).toHaveBeenCalledWith(102, "resolved", 16));
    await waitFor(() => expect(api.foreshadowsList).toHaveBeenCalledTimes(2));
  });

  it("搁置调 setStatus(dropped, null)；删除需二次确认", async () => {
    render(<ForeshadowPanel />);

    fireEvent.click((await screen.findAllByTitle("搁置"))[0]); // 黑袍人
    await waitFor(() => expect(api.foreshadowSetStatus).toHaveBeenCalledWith(102, "dropped", null));

    fireEvent.click((await screen.findAllByTitle("删除"))[0]);
    expect(api.foreshadowDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle("确认删除"));
    await waitFor(() => expect(api.foreshadowDelete).toHaveBeenCalledWith(102));
  });

  it("未选书时给空态且不拉数据", async () => {
    useWorkspace.setState({ currentBookId: null, currentChapterId: null });
    render(<ForeshadowPanel />);
    expect(await screen.findByText("请先选择书籍")).toBeInTheDocument();
    expect(api.foreshadowsList).not.toHaveBeenCalled();
  });
});
