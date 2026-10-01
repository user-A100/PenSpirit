import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown, parseMarkdown } from "./Markdown";

describe("Markdown", () => {
  it("块级解析：标题/列表/有序/引用/代码/分隔线/段落", () => {
    const blocks = parseMarkdown("## 方向\n- 甲\n- 乙\n1. 一\n2. 二\n> 引\n```\ncode\n```\n---\n普通段落\n第二行");
    expect(blocks.map((b) => b.t)).toEqual(["h", "ul", "ol", "quote", "code", "hr", "p"]);
  });
  it("行内粗体/代码渲染为元素，不注入 HTML", () => {
    render(<Markdown text={"**重点** 与 `代码` <script>x</script>"} />);
    expect(screen.getByText("重点").tagName).toBe("STRONG");
    expect(screen.getByText("代码").tagName).toBe("CODE");
    expect(document.querySelector("script")).toBeNull();
  });
});
