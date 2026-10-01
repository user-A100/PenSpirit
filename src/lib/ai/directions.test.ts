import { describe, expect, it } from "vitest";
import { parseDirections } from "./directions";
import { estimateTokens } from "./tokens";

describe("parseDirections", () => {
  it("编号的几种写法、续行并入、去粗体", () => {
    expect(parseDirections("1. 雪夜追兵\n2、林晚负伤\n3）**旧城失火**，主角被困")).toEqual(["雪夜追兵", "林晚负伤", "旧城失火，主角被困"]);
    expect(parseDirections("可以这样走：\n一、正面冲突\n对方先动手。\n二、暗线推进")).toEqual(["正面冲突对方先动手。", "暗线推进"]);
    expect(parseDirections("**走向一**：反派现身\n**走向二**：误会加深")).toEqual(["反派现身", "误会加深"]);
    expect(parseDirections("只是一段话，没有编号")).toEqual([]);
  });
});

describe("estimateTokens", () => {
  it("与后端同口径", () => {
    expect(estimateTokens("雪夜")).toBe(4);
    expect(estimateTokens("hello world")).toBe(3);
  });
});
