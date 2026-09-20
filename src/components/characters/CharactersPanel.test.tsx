import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CharactersPanel } from "./CharactersPanel";
import { useCharacters } from "../../stores/characters";
import { useWorkspace } from "../../stores/workspace";
import { api, type Character } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    charactersList: vi.fn(),
    characterUpsert: vi.fn(),
    characterDelete: vi.fn(),
  },
}));

function ch(id: number, name: string, role = "", aliases = "", description = ""): Character {
  return { id, book_id: 1, name, role, aliases, description, created_at: "", updated_at: "" };
}

describe("CharactersPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkspace.setState({ books: [], chapters: [], currentBookId: 1, currentChapterId: null, chapterContent: null });
    useCharacters.setState({ bookId: null, list: [] });
    (window as unknown as { confirm: unknown }).confirm = vi.fn(() => true);
  });

  it("挂载按当前书拉取人物卡并渲染", async () => {
    vi.mocked(api.charactersList).mockResolvedValue([ch(1, "胡八一", "主角", "老胡", "摸金校尉")]);
    render(<CharactersPanel />);
    await waitFor(() => expect(screen.getByText("胡八一")).toBeInTheDocument());
    expect(api.charactersList).toHaveBeenCalledWith(1);
    expect(screen.getByText("主角")).toBeInTheDocument();
    expect(screen.getByText("别名：老胡")).toBeInTheDocument();
    expect(screen.getByText("摸金校尉")).toBeInTheDocument();
    expect(screen.getByText(/人物卡（1）/)).toBeInTheDocument();
  });

  it("无选中书显示提示", () => {
    useWorkspace.setState({ currentBookId: null });
    render(<CharactersPanel />);
    expect(screen.getByText("请先选择书籍")).toBeInTheDocument();
  });

  it("新建：姓名必填，成功后关闭表单并刷新", async () => {
    vi.mocked(api.charactersList).mockResolvedValue([]);
    vi.mocked(api.characterUpsert).mockResolvedValue(ch(9, "Shirley杨"));
    render(<CharactersPanel />);

    fireEvent.click(screen.getByTitle("新建人物卡"));
    // 空姓名拦截
    fireEvent.click(screen.getByText("创建"));
    expect(screen.getByText("姓名不能为空")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("姓名（必填）"), { target: { value: "Shirley杨" } });
    fireEvent.change(screen.getByPlaceholderText(/别名/), { target: { value: "杨小姐" } });
    fireEvent.click(screen.getByText("创建"));

    await waitFor(() =>
      expect(api.characterUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, book_id: 1, name: "Shirley杨", aliases: "杨小姐" }),
      ),
    );
  });

  it("删除：confirm 确认后调 Rust 删除", async () => {
    vi.mocked(api.charactersList).mockResolvedValue([ch(3, "王胖子", "配角")]);
    vi.mocked(api.characterDelete).mockResolvedValue(undefined);
    render(<CharactersPanel />);
    await waitFor(() => screen.getByText("王胖子"));

    fireEvent.click(screen.getByTitle("删除"));
    await waitFor(() => expect(api.characterDelete).toHaveBeenCalledWith(3));
  });
});
