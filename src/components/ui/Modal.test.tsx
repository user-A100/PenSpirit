import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { Modal } from "./Modal";

describe("Modal", () => {
  it("open=false 不渲染", () => {
    render(createElement(Modal, { open: false, onClose: () => {}, testId: "m", children: "内容" }));
    expect(screen.queryByTestId("m")).toBeNull();
  });

  it("标题栏存在时点 X 关闭；省略 title 则不渲染标题栏", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      createElement(Modal, { open: true, onClose, title: "设置", testId: "m", children: "内容" }),
    );
    expect(screen.getByText("设置")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("关闭"));
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();

    render(createElement(Modal, { open: true, onClose: () => {}, testId: "m", children: "内容" }));
    expect(screen.queryByTitle("关闭")).toBeNull();
  });

  it("点 backdrop 关闭、点面板内部不关闭", () => {
    const onClose = vi.fn();
    render(createElement(Modal, { open: true, onClose, testId: "m", children: "面板内容" }));
    fireEvent.click(screen.getByText("面板内容"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("m"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭；关闭后卸载不再响应", () => {
    const onClose = vi.fn();
    const { unmount } = render(
      createElement(Modal, { open: true, onClose, testId: "m", children: "内容" }),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);

    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
