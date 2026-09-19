import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta } from "../../lib/tauri";
import {
  READING_LOCKS_KEY,
  useReadingPanels,
  type PanelPos,
} from "./readingPanels";
import { NavPanel } from "./NavPanel";
import { BottomPanel } from "./BottomPanel";

// ---- 造数：三章目录 ----
function ch(id: number, title: string): ChapterMeta {
  return {
    id, book_id: 1, title, sort_key: id, word_count: 100,
    file_path: `book/manuscript/${id}.md`, created_at: "", updated_at: "",
  };
}
const CHAPTERS = [ch(11, "风雪夜"), ch(12, "Storm Harbour"), ch(13, "归途")];

function resetPanels() {
  useReadingPanels.setState({
    left: false, right: false, top: false, bottom: false,
    navLocked: false, settingLocked: false,
  });
}

describe("useReadingPanels", () => {
  beforeEach(() => {
    localStorage.clear();
    resetPanels();
  });

  it("初始四面板全关（无锁定时）", () => {
    const s = useReadingPanels.getState();
    expect(s.left).toBe(false);
    expect(s.right).toBe(false);
    expect(s.top).toBe(false);
    expect(s.bottom).toBe(false);
  });

  it("open/close/toggle 各面板", () => {
    const s0 = useReadingPanels.getState();
    s0.open("left");
    expect(useReadingPanels.getState().left).toBe(true);
    s0.open("bottom");
    expect(useReadingPanels.getState().bottom).toBe(true);

    useReadingPanels.getState().close("left");
    expect(useReadingPanels.getState().left).toBe(false);
    expect(useReadingPanels.getState().bottom).toBe(true); // 其余不动

    useReadingPanels.getState().toggle("top");
    expect(useReadingPanels.getState().top).toBe(true);
    useReadingPanels.getState().toggle("top");
    expect(useReadingPanels.getState().top).toBe(false);
  });

  it("四位置均可 open/close", () => {
    (["left", "right", "top", "bottom"] as PanelPos[]).forEach((p) => {
      useReadingPanels.getState().open(p);
      expect(useReadingPanels.getState()[p]).toBe(true);
      useReadingPanels.getState().close(p);
      expect(useReadingPanels.getState()[p]).toBe(false);
    });
  });

  it("锁定左面板 → 常驻打开且 close 无效；解锁后可关", () => {
    useReadingPanels.getState().setNavLocked(true);
    expect(useReadingPanels.getState().left).toBe(true); // 常驻
    useReadingPanels.getState().close("left");
    expect(useReadingPanels.getState().left).toBe(true); // 锁定不吃 close
    useReadingPanels.getState().toggle("left");
    expect(useReadingPanels.getState().left).toBe(true);

    useReadingPanels.getState().setNavLocked(false);
    useReadingPanels.getState().close("left");
    expect(useReadingPanels.getState().left).toBe(false);
  });

  it("锁定右面板 → 常驻打开且 close 无效", () => {
    useReadingPanels.getState().setSettingLocked(true);
    expect(useReadingPanels.getState().right).toBe(true);
    useReadingPanels.getState().close("right");
    expect(useReadingPanels.getState().right).toBe(true);
  });

  it("锁定状态持久化到 bixian.reading.locks", () => {
    useReadingPanels.getState().setNavLocked(true);
    useReadingPanels.getState().setSettingLocked(true);
    expect(JSON.parse(localStorage.getItem(READING_LOCKS_KEY) ?? "null")).toEqual({
      navLocked: true, settingLocked: true,
    });
    useReadingPanels.getState().setSettingLocked(false);
    expect(JSON.parse(localStorage.getItem(READING_LOCKS_KEY) ?? "null")).toEqual({
      navLocked: true, settingLocked: false,
    });
  });

  it("重建 store 时从 localStorage 恢复锁定并常驻对应面板", async () => {
    useReadingPanels.getState().setNavLocked(true);
    vi.resetModules();
    const fresh = await import("./readingPanels");
    const s = fresh.useReadingPanels.getState();
    expect(s.navLocked).toBe(true);
    expect(s.settingLocked).toBe(false);
    expect(s.left).toBe(true); // 锁定恢复 → 常驻
    expect(s.right).toBe(false);
    expect(s.top).toBe(false);
    expect(s.bottom).toBe(false);
  });

  it("坏 JSON 回全不锁", async () => {
    localStorage.setItem(READING_LOCKS_KEY, "{not json");
    vi.resetModules();
    const fresh = await import("./readingPanels");
    expect(fresh.useReadingPanels.getState().navLocked).toBe(false);
    expect(fresh.useReadingPanels.getState().settingLocked).toBe(false);
  });
});

describe("NavPanel", () => {
  const onSelectChapter = vi.fn();

  function setup(currentChapterId: number | null = 12) {
    render(
      <NavPanel
        bookTitle="笔仙"
        chapters={CHAPTERS}
        currentChapterId={currentChapterId}
        onSelectChapter={onSelectChapter}
      />,
    );
  }

  it("渲染书名、全部章节与「本书 N 章」", () => {
    setup();
    expect(screen.getByText("笔仙")).toBeInTheDocument();
    expect(screen.getByText("风雪夜")).toBeInTheDocument();
    expect(screen.getByText("Storm Harbour")).toBeInTheDocument();
    expect(screen.getByText("归途")).toBeInTheDocument();
    expect(screen.getByText("本书 3 章")).toBeInTheDocument();
  });

  it("当前章高亮（data-current），其余不高亮", () => {
    setup(12);
    expect(screen.getByText("Storm Harbour").closest("[data-current]")).not.toBeNull();
    expect(screen.getByText("风雪夜").closest("[data-current]")).toBeNull();
    expect(screen.getByText("归途").closest("[data-current]")).toBeNull();
  });

  it("过滤输入框：标题子串不区分大小写", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/过滤/), { target: { value: "storm" } });
    expect(screen.queryByText("风雪夜")).toBeNull();
    expect(screen.getByText("Storm Harbour")).toBeInTheDocument();
    expect(screen.getByText("本书 3 章")).toBeInTheDocument(); // 底部计数仍是全书

    fireEvent.change(screen.getByPlaceholderText(/过滤/), { target: { value: "归" } });
    expect(screen.getByText("归途")).toBeInTheDocument();
    expect(screen.queryByText("Storm Harbour")).toBeNull();
  });

  it("过滤无命中显示空态提示", () => {
    setup();
    fireEvent.change(screen.getByPlaceholderText(/过滤/), { target: { value: "不存在的章" } });
    expect(screen.getByText(/无匹配章节/)).toBeInTheDocument();
  });

  it("点击章节项回调 selectChapter", () => {
    setup();
    fireEvent.click(screen.getByText("归途"));
    expect(onSelectChapter).toHaveBeenCalledWith(13);
  });
});

describe("BottomPanel", () => {
  const onSelectChapter = vi.fn();
  const onPrev = vi.fn();
  const onNext = vi.fn();

  function setup(current = 12, prevDisabled = false, nextDisabled = false) {
    render(
      <BottomPanel
        chapters={CHAPTERS}
        currentChapterId={current}
        onSelectChapter={onSelectChapter}
        onPrev={onPrev}
        onNext={onNext}
        prevDisabled={prevDisabled}
        nextDisabled={nextDisabled}
      />,
    );
  }

  it("显示「第 X / N 章」与进度滑条", () => {
    setup();
    expect(screen.getByText("第 2 / 3 章")).toBeInTheDocument();
    const slider = screen.getByRole("slider");
    expect(slider).toHaveAttribute("min", "1");
    expect(slider).toHaveAttribute("max", "3");
    expect((slider as HTMLInputElement).value).toBe("2");
  });

  it("滑条换章：change 到第 1 章 → selectChapter(11)", () => {
    setup();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "1" } });
    expect(onSelectChapter).toHaveBeenCalledWith(11);
  });

  it("滑条换章：change 到第 3 章 → selectChapter(13)", () => {
    setup();
    fireEvent.change(screen.getByRole("slider"), { target: { value: "3" } });
    expect(onSelectChapter).toHaveBeenCalledWith(13);
  });

  it("上一章/下一章按钮回调", () => {
    setup();
    fireEvent.click(screen.getByTitle(/上一章/));
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle(/下一章/));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("首/末章时对应按钮禁用", () => {
    setup(11, true, false);
    expect((screen.getByTitle(/上一章/) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTitle(/下一章/) as HTMLButtonElement).disabled).toBe(false);
  });
});
