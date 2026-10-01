import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuHost } from "./MenuHost";
import { closeMenu, useMenu, type MenuEntry } from "../../stores/menu";

function openAt(items: MenuEntry[]) {
  act(() => useMenu.getState().open({ x: 10, y: 10, items }));
}

afterEach(() => {
  act(() => closeMenu());
});

describe("MenuHost", () => {
  it("点击菜单项：先关闭再执行动作", async () => {
    const onSelect = vi.fn();
    render(<MenuHost />);
    openAt([{ label: "重命名", onSelect }]);
    fireEvent.click(screen.getByText("重命名"));
    expect(useMenu.getState().req).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("键盘：↓ 跳过分隔线与禁用项，Enter 执行，Esc 关闭", async () => {
    const a = vi.fn();
    const c = vi.fn();
    render(<MenuHost />);
    openAt([
      { label: "甲", onSelect: a },
      { type: "separator" },
      { label: "乙", disabled: true },
      { label: "丙", onSelect: c },
    ]);
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" }); // 甲
    fireEvent.keyDown(menu, { key: "ArrowDown" }); // 跳过分隔线与乙 → 丙
    fireEvent.keyDown(menu, { key: "Enter" });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(c).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();

    openAt([{ label: "甲", onSelect: a }]);
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(useMenu.getState().req).toBeNull();
  });

  it("→ 打开子菜单并聚焦，← 退回父菜单", async () => {
    const pick = vi.fn();
    render(<MenuHost />);
    openAt([{ label: "标签", submenu: [{ label: "红", swatch: "#f00", onSelect: pick }] }]);
    const root = screen.getByRole("menu");
    fireEvent.keyDown(root, { key: "ArrowDown" });
    fireEvent.keyDown(root, { key: "ArrowRight" });
    const menus = screen.getAllByRole("menu");
    expect(menus).toHaveLength(2);
    expect(document.activeElement).toBe(menus[1]);
    fireEvent.keyDown(menus[1], { key: "ArrowLeft" });
    expect(screen.getAllByRole("menu")).toHaveLength(1);
    expect(document.activeElement).toBe(root);
  });

  it("点击菜单外部关闭，且不把焦点抢回触发按钮", () => {
    render(
      <>
        <button>触发</button>
        <input aria-label="别处" />
        <MenuHost />
      </>,
    );
    screen.getByText("触发").focus();
    openAt([{ label: "甲" }]);
    const input = screen.getByLabelText("别处");
    fireEvent.mouseDown(input);
    input.focus();
    expect(useMenu.getState().req).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("Esc 关闭后焦点还给触发按钮；焦点不在面板上时 Esc 也能关", () => {
    render(
      <>
        <button>触发</button>
        <MenuHost />
      </>,
    );
    const btn = screen.getByText("触发");
    btn.focus();
    openAt([{ label: "甲" }]);
    btn.focus(); // 模拟面板没拿到焦点
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useMenu.getState().req).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
});
