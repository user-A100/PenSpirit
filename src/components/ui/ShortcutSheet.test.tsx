import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ShortcutSheet, useShortcutSheet } from "./ShortcutSheet";
import { registerCommands } from "../../lib/commands";

beforeEach(() => useShortcutSheet.setState({ open: false }));

describe("快捷键速查（阶段 4）", () => {
  it("数据来自命令注册表：注册了键位的命令自动出现，按分类分组、可搜索", () => {
    const un = registerCommands([
      { id: "t.split", title: "分屏：无 / 左右 / 上下", category: "编辑", keys: ["Alt+S"], run: () => {} },
      { id: "t.find", title: "在 AI 对话中查找", category: "AI", keys: ["Mod+F"], run: () => {} },
      { id: "t.nokey", title: "没有快捷键的命令", category: "AI", run: () => {} },
    ]);
    render(<ShortcutSheet />);
    expect(screen.queryByTestId("shortcut-sheet")).toBeNull();
    act(() => useShortcutSheet.getState().toggle());
    expect(screen.getByText("分屏：无 / 左右 / 上下")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+F")).toBeInTheDocument();
    expect(screen.queryByText("没有快捷键的命令")).toBeNull();
    expect(screen.getByText("接受幽灵补全的灰字")).toBeInTheDocument();
    expect(document.querySelector('[data-shortcut-group="编辑"]')).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索快捷键"), { target: { value: "分屏" } });
    expect(document.querySelectorAll("[data-shortcut-row]")).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("搜索快捷键"), { target: { value: "alt+s" } });
    expect(document.querySelectorAll("[data-shortcut-row]")).toHaveLength(1);
    act(() => useShortcutSheet.getState().toggle());
    expect(screen.queryByTestId("shortcut-sheet")).toBeNull();
    un();
  });
});
