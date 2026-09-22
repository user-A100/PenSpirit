import { describe, expect, it } from "vitest";
import { openWiki, wikiCandidates, wikiRanges } from "./wiki";

describe("wikiRanges（[[章题]] 区间提取）", () => {
  it("提取全部链接的区间与目标；目标 trim", () => {
    const text = "前文[[下山]]中段[[ 入山 ]]后文";
    const rs = wikiRanges(text);
    expect(rs).toHaveLength(2);
    expect(rs[0]).toEqual({ from: 2, to: 8, target: "下山" });
    expect(rs[1].target).toBe("入山");
    expect(text.slice(rs[1].from, rs[1].to)).toBe("[[ 入山 ]]");
  });

  it("嵌套方括号与空目标不误匹配", () => {
    expect(wikiRanges("[[a[b]] [[ ]] [[ ]]")).toHaveLength(0);
    expect(wikiRanges("普通文本没有链接")).toHaveLength(0);
  });

  it("连续链接相邻也能切开", () => {
    const rs = wikiRanges("[[甲]][[乙]]");
    expect(rs.map((r) => r.target)).toEqual(["甲", "乙"]);
    expect(rs[1].from).toBe(5);
  });
});

describe("openWiki（未闭合 [[ 检测）", () => {
  it("光标前是 [[查询 时返回起点与查询词", () => {
    expect(openWiki("他在[[下")).toEqual({ from: 2, query: "下" });
    expect(openWiki("[[")).toEqual({ from: 0, query: "" });
  });

  it("已闭合/无括号/单括号返回 null", () => {
    expect(openWiki("已闭合[[下山]]的")).toBeNull();
    expect(openWiki("普通[文本")).toBeNull();
    expect(openWiki("")).toBeNull();
  });

  it("同段内闭合后再开新括号取最近一段", () => {
    expect(openWiki("[[旧]]文[[新")).toEqual({ from: 6, query: "新" });
  });
});

describe("wikiCandidates（候选过滤）", () => {
  const titles = ["下山", "下山报仇", "入山", "下山"];

  it("包含匹配、排除与查询全同的章题、去重截断", () => {
    expect(wikiCandidates("下山", titles)).toEqual(["下山报仇"]);
    expect(wikiCandidates("", titles)).toEqual(["下山", "下山报仇", "入山"]);
    expect(wikiCandidates("山", titles, 2)).toEqual(["下山", "下山报仇"]);
  });

  it("查询前后空白不影响匹配", () => {
    expect(wikiCandidates(" 下山 ", titles)).toEqual(["下山报仇"]);
  });

  it("无命中返回空数组", () => {
    expect(wikiCandidates("不存在", titles)).toEqual([]);
  });
});
