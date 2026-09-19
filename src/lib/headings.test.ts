import { describe, expect, it } from "vitest";
import { parseHeadings } from "./headings";

// M3-T7 悬浮大纲：两级大纲抽取。规则见实现头注释。

describe("parseHeadings", () => {
  it("markdown # / ## 抽为两级", () => {
    const md = "# 序章\n\n正文。\n\n## 转折\n\n更多正文。\n";
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "序章" },
      { level: 2, text: "转折" },
    ]);
  });

  it("### 及更深、无空格 # 都不算标题", () => {
    expect(parseHeadings("### 深层\n#贴住\n#### 更深\n##也无空格\n")).toEqual([]);
  });

  it("行首三格内缩进仍算；四格（代码块）不算", () => {
    expect(parseHeadings("   ## 缩进\n # 一级\n")).toEqual([
      { level: 2, text: "缩进" },
      { level: 1, text: "一级" },
    ]);
    expect(parseHeadings("    ## 代码块\n")).toEqual([]);
  });

  it("中文章题行抽为一级（章/回/节，汉字与阿拉伯数字皆可）", () => {
    const md = [
      "第十二章 风雪夜",
      "他推门进来，抖落一肩的雪。",
      "第一百二十章 雪停了",
      "第三回 大闹一场",
      "第9节 收束",
    ].join("\n");
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "第十二章 风雪夜" },
      { level: 1, text: "第一百二十章 雪停了" },
      { level: 1, text: "第三回 大闹一场" },
      { level: 1, text: "第9节 收束" },
    ]);
  });

  it("普通「第…」句子不是章题（量词/日子不带章节字）", () => {
    expect(parseHeadings("第二天他去镇上。\n第二天，天亮了。\n第三次回望。\n")).toEqual([]);
  });

  it("章题后余文至多 30 字，超出不算", () => {
    expect(parseHeadings("第一章" + "风".repeat(30) + "\n")).toEqual([
      { level: 1, text: "第一章" + "风".repeat(30) },
    ]);
    expect(parseHeadings("第一章" + "风".repeat(31) + "\n")).toEqual([]);
  });

  it("同类标题重复只保留首次（去重保序）", () => {
    const md = "# 序\n## 转折\n# 序\n第十二章 风雪\n第十二章 风雪\n## 转折\n";
    expect(parseHeadings(md)).toEqual([
      { level: 1, text: "序" },
      { level: 2, text: "转折" },
      { level: 1, text: "第十二章 风雪" },
    ]);
  });

  it("无标题与空串都回空数组", () => {
    expect(parseHeadings("只是正文，没有结构。\n再一行。")).toEqual([]);
    expect(parseHeadings("")).toEqual([]);
  });

  it("标题两端空白被裁掉", () => {
    expect(parseHeadings("#   序章  \n  第十二章  风雪 \n")).toEqual([
      { level: 1, text: "序章" },
      { level: 1, text: "第十二章  风雪" },
    ]);
  });
});
