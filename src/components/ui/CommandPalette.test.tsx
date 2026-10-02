import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { usePalette } from "../../stores/palette";
import { useWorkspace } from "../../stores/workspace";
import { registerCommand } from "../../lib/commands";

vi.mock("../../lib/tauri", () => ({
  api: { readChapter: vi.fn().mockResolvedValue({ meta: {}, content: "" }) },
}));

const meta = { synopsis: "", label_id: null, status_id: null, target_words: null };
const ch = (id: number, title: string) => ({ id, book_id: 1, file_path: "", title, sort_key: id, word_count: 100 * id, created_at: "", updated_at: "", ...meta });

const offs: Array<() => void> = [];
beforeEach(() => {
  useWorkspace.setState({
    books: [{ id: 1, slug: "a", title: "雪夜渡", created_at: "", updated_at: "", target_words: null }],
    chapters: [ch(1, "序章 渡口"), ch(2, "第一章 风雪夜归人"), ch(3, "第二章 旧城灯火")],
    currentBookId: 1,
    history: [1, 3],
    historyIndex: 1,
  });
});
afterEach(() => {
  while (offs.length) offs.pop()!();
  act(() => usePalette.getState().close());
});

describe("CommandPalette", () => {
  it("空查询列出最近章节；拼音首字母跳章", async () => {
    render(<CommandPalette />);
    act(() => usePalette.getState().openPalette());
    expect(screen.getByText("最近")).toBeInTheDocument();
    const input = screen.getByLabelText("搜索章节、书与命令");
    fireEvent.change(input, { target: { value: "jcdh" } });
    const first = screen.getAllByRole("option")[0];
    expect(first.textContent).toContain("第二章 旧城灯火");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(usePalette.getState().open).toBe(false);
    expect(useWorkspace.getState().currentChapterId).toBe(3);
  });

  it("> 前缀只搜命令；Enter 执行命令", async () => {
    const run = vi.fn();
    offs.push(registerCommand({ id: "test.hello", title: "打个招呼", keys: ["Mod+Alt+H"], run }));
    render(<CommandPalette />);
    act(() => usePalette.getState().openPalette(">"));
    const input = screen.getByLabelText("搜索章节、书与命令");
    fireEvent.change(input, { target: { value: ">招呼" } });
    expect(screen.queryByText("章节")).toBeNull();
    expect(screen.getByText("Ctrl+Alt+H")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭", () => {
    render(<CommandPalette />);
    act(() => usePalette.getState().openPalette());
    fireEvent.keyDown(screen.getByLabelText("搜索章节、书与命令"), { key: "Escape" });
    expect(usePalette.getState().open).toBe(false);
  });
});
