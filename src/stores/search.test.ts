import { beforeEach, describe, expect, it, vi } from "vitest";
import { useSearch } from "./search";
import { useWorkspace } from "./workspace";

vi.mock("../lib/tauri", () => ({
  api: { searchBook: vi.fn() },
}));

import { api, type SearchHit } from "../lib/tauri";

const HIT: SearchHit = {
  chapter_id: 12, chapter_title: "第二章", line_no: 3,
  line_text: "  风雪很大。", match_start: 2, match_end: 4,
};

describe("search store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearch.setState({
      open: false, query: "", wholeWord: false, scope: "all", hits: [], truncated: false,
      loading: false, error: null, jumpText: null,
    });
  });

  it("空关键词不发请求并清空结果", async () => {
    useSearch.setState({ query: "   ", hits: [HIT], truncated: true });
    await useSearch.getState().search(1);

    expect(api.searchBook).not.toHaveBeenCalled();
    expect(useSearch.getState().hits).toEqual([]);
    expect(useSearch.getState().truncated).toBe(false);
  });

  it("没有选中书时不发请求", async () => {
    useSearch.setState({ query: "风雪" });
    await useSearch.getState().search(null);
    expect(api.searchBook).not.toHaveBeenCalled();
  });

  it("写入命中与截断标记", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [HIT], truncated: true });
    useSearch.setState({ query: "风雪", wholeWord: true });
    await useSearch.getState().search(7);

    expect(api.searchBook).toHaveBeenCalledWith(7, "风雪", true, "all");
    const s = useSearch.getState();
    expect(s.hits).toEqual([HIT]);
    expect(s.truncated).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.error).toBeNull();
  });

  it("报错时记录错误并清空结果", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockRejectedValue("读取失败");
    useSearch.setState({ query: "风雪" });
    await useSearch.getState().search(7);

    expect(useSearch.getState().error).toContain("读取失败");
    expect(useSearch.getState().hits).toEqual([]);
  });

  it("setScope 换范围后随查询传递", async () => {
    (api.searchBook as ReturnType<typeof vi.fn>).mockResolvedValue({ hits: [], truncated: false });
    useSearch.setState({ query: "风雪", scope: "title" });
    await useSearch.getState().search(7);
    expect(api.searchBook).toHaveBeenCalledWith(7, "风雪", false, "title");
  });

  it("跳转：切章 + 把整行文本交给编辑器 + 关闭面板", async () => {
    const selectChapter = vi.fn().mockResolvedValue(undefined);
    useWorkspace.setState({ selectChapter });
    useSearch.setState({ open: true, hits: [HIT] });

    await useSearch.getState().jump(HIT);

    expect(selectChapter).toHaveBeenCalledWith(12);
    expect(useSearch.getState().jumpText).toBe("风雪很大。"); // 已 trim
    expect(useSearch.getState().open).toBe(false);

    useSearch.getState().clearJump();
    expect(useSearch.getState().jumpText).toBeNull();
  });

  it("空行命中不产生跳转文本", async () => {
    useWorkspace.setState({ selectChapter: vi.fn().mockResolvedValue(undefined) });
    await useSearch.getState().jump({ ...HIT, line_text: "   " });
    expect(useSearch.getState().jumpText).toBeNull();
  });
});
