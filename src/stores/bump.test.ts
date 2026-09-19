import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseList, parseTags, useBump } from "./bump";

vi.mock("../lib/tauri", () => ({
  api: {
    bumpListWords: vi.fn(), bumpAddWord: vi.fn(), bumpDeleteWord: vi.fn(), bumpClearWords: vi.fn(),
    bumpDraw: vi.fn(), ideasList: vi.fn(), ideasCreate: vi.fn(), ideasDelete: vi.fn(),
  },
}));

import { api, type BumpWord, type Idea } from "../lib/tauri";

const W = (id: number, word: string): BumpWord => ({ id, word, created_at: "" });
const IDEA: Idea = { id: 1, content: "备注", words_json: '["雨夜","邮差"]', tags_json: '["悬疑"]', created_at: "" };

describe("bump store helpers", () => {
  it("parseTags 认中英文分隔符并去空", () => {
    expect(parseTags("悬疑 都市,科幻、奇幻")).toEqual(["悬疑", "都市", "科幻", "奇幻"]);
    expect(parseTags("  ")).toEqual([]);
    expect(parseTags("")).toEqual([]);
  });

  it("parseList 对坏 JSON 退化而非抛错", () => {
    expect(parseList('["a","b"]')).toEqual(["a", "b"]);
    expect(parseList("not json")).toEqual([]);
    expect(parseList('{"a":1}')).toEqual([]);
    expect(parseList('[1,"a",null]')).toEqual(["a"]); // 非字符串元素被剔除
  });
});

describe("bump store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useBump.setState({
      words: [], ideas: [], drawn: [], count: 3, note: "", tags: "", busy: false, error: null,
    });
  });

  it("load 同时拉词库与灵感卡", async () => {
    (api.bumpListWords as ReturnType<typeof vi.fn>).mockResolvedValue([W(1, "蝴蝶")]);
    (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([IDEA]);

    await useBump.getState().load();

    expect(useBump.getState().words).toEqual([W(1, "蝴蝶")]);
    expect(useBump.getState().ideas).toEqual([IDEA]);
    expect(useBump.getState().error).toBeNull();
  });

  it("addWord 之后用后端返回的列表刷新（保持顺序与去重以后端为准）", async () => {
    (api.bumpAddWord as ReturnType<typeof vi.fn>).mockResolvedValue(W(2, "灯塔"));
    (api.bumpListWords as ReturnType<typeof vi.fn>).mockResolvedValue([W(1, "蝴蝶"), W(2, "灯塔")]);

    await useBump.getState().addWord("灯塔");

    expect(api.bumpAddWord).toHaveBeenCalledWith("灯塔");
    expect(useBump.getState().words.map((w) => w.word)).toEqual(["蝴蝶", "灯塔"]);
  });

  it("addWord 失败时记录错误且不清空已有词库", async () => {
    useBump.setState({ words: [W(1, "蝴蝶")] });
    (api.bumpAddWord as ReturnType<typeof vi.fn>).mockRejectedValue("词不能为空");

    await useBump.getState().addWord(" ");

    expect(useBump.getState().error).toContain("词不能为空");
    expect(useBump.getState().words).toHaveLength(1);
  });

  it("draw 用当前抽取数量，失败时清空结果", async () => {
    (api.bumpDraw as ReturnType<typeof vi.fn>).mockResolvedValue(["雨夜", "邮差"]);
    useBump.setState({ count: 2 });
    await useBump.getState().draw();
    expect(api.bumpDraw).toHaveBeenCalledWith(2);
    expect(useBump.getState().drawn).toEqual(["雨夜", "邮差"]);
    expect(useBump.getState().busy).toBe(false);

    (api.bumpDraw as ReturnType<typeof vi.fn>).mockRejectedValue("词库至少需要 2 个词");
    await useBump.getState().draw();
    expect(useBump.getState().drawn).toEqual([]);
    expect(useBump.getState().error).toContain("至少需要");
  });

  it("saveIdea 存词组与标签 JSON，成功后清空备注并刷新列表", async () => {
    useBump.setState({ drawn: ["雨夜", "邮差"], note: "  一个念头  ", tags: "悬疑 都市" });
    (api.ideasCreate as ReturnType<typeof vi.fn>).mockResolvedValue(IDEA);
    (api.ideasList as ReturnType<typeof vi.fn>).mockResolvedValue([IDEA]);

    await useBump.getState().saveIdea();

    expect(api.ideasCreate).toHaveBeenCalledWith("  一个念头  ", '["雨夜","邮差"]', '["悬疑","都市"]');
    expect(useBump.getState().ideas).toEqual([IDEA]);
    expect(useBump.getState().note).toBe("");
    expect(useBump.getState().tags).toBe("");
  });

  it("没有碰撞结果时不存卡", async () => {
    useBump.setState({ drawn: [] });
    await useBump.getState().saveIdea();
    expect(api.ideasCreate).not.toHaveBeenCalled();
  });

  it("清空词库同时清掉当前碰撞结果", async () => {
    useBump.setState({ words: [W(1, "蝴蝶")], drawn: ["蝴蝶", "菜刀"] });
    (api.bumpClearWords as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await useBump.getState().clearWords();

    expect(useBump.getState().words).toEqual([]);
    expect(useBump.getState().drawn).toEqual([]);
  });
});
