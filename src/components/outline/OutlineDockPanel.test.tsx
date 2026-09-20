import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OutlineDockPanel } from "./OutlineDockPanel";
import { useWorkspace } from "../../stores/workspace";
import type { ChapterMeta } from "../../lib/tauri";

function ch(id: number, title: string): ChapterMeta {
  return { id, book_id: 1, title, sort_key: id, word_count: 0, file_path: "", created_at: "", updated_at: "" };
}

describe("OutlineDockPanel", () => {
  beforeEach(() => {
    useWorkspace.setState({
      books: [],
      chapters: [ch(11, "风雪夜"), ch(12, "旧债")],
      currentChapterId: 11,
      chapterContent: "## 出城\n\n雪很大。\n\n## 遇袭\n\n刀光一闪。",
    });
  });

  it("渲染本章小标题与全书章节，当前章高亮", () => {
    render(<OutlineDockPanel />);
    expect(screen.getByText("出城")).toBeInTheDocument();
    expect(screen.getByText("遇袭")).toBeInTheDocument();
    expect(screen.getByText("风雪夜").className).toContain("active");
    expect(screen.getByText("旧债").className).not.toContain("active");
  });

  it("点击其它章切换 selectChapter；重复点击当前章不重读", () => {
    const sel = vi.fn();
    useWorkspace.setState({ selectChapter: sel });
    render(<OutlineDockPanel />);
    fireEvent.click(screen.getByText("旧债"));
    expect(sel).toHaveBeenCalledWith(12);
    fireEvent.click(screen.getByText("风雪夜"));
    expect(sel).toHaveBeenCalledTimes(1); // 当前章不重复选择
  });

  it("无小标题时显示空态", () => {
    useWorkspace.setState({ chapterContent: "平铺直叙的正文。" });
    render(<OutlineDockPanel />);
    expect(screen.getByText("本章无小标题")).toBeInTheDocument();
  });
});
