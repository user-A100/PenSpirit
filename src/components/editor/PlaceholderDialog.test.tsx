import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { PlaceholderDialog, scanPlaceholders } from "./PlaceholderDialog";

describe("scanPlaceholders", () => {
  it("四类占位符全命中，带行号", () => {
    const md = "正常一句。\n这里有个[待补充：武功名]，还有（暂名）。\n再一个{主角旧姓}和【待改】。";
    const hits = scanPlaceholders(md);
    expect(hits.map((h) => h.text)).toEqual(["[待补充：武功名]", "（暂名）", "{主角旧姓}", "【待改】"]);
    expect(hits[0].line).toBe(2);
  });

  it("普通括号与句子不误报", () => {
    expect(scanPlaceholders("他说（笑）了句话。")).toEqual([]);
    expect(scanPlaceholders("数组 arr[0] 取值")).toEqual([]);
  });
});

describe("PlaceholderDialog", () => {
  it("空结果与命中两态", () => {
    const { rerender } = render(createElement(PlaceholderDialog, { content: "干净正文", onClose: () => {} }));
    expect(screen.getByText(/未发现占位符/)).toBeInTheDocument();
    rerender(createElement(PlaceholderDialog, { content: "看[待定]", onClose: () => {} }));
    expect(screen.getByText(/发现 1 处占位符/)).toBeInTheDocument();
    expect(screen.getByText("[待定]")).toBeInTheDocument();
  });
});
