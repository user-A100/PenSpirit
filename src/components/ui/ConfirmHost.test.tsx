import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmHost } from "./ConfirmHost";
import { confirmDialog, promptDialog } from "../../stores/confirm";

describe("ConfirmHost", () => {
  it("点确认 resolve(true)；点取消 resolve(false)", async () => {
    render(<ConfirmHost />);
    let p!: Promise<boolean>;
    act(() => {
      p = confirmDialog({ title: "删除集合「精选」？", confirmLabel: "删除", danger: true });
    });
    expect(screen.getByText("删除集合「精选」？")).toBeInTheDocument();
    fireEvent.click(screen.getByText("删除"));
    await expect(p).resolves.toBe(true);
    expect(screen.queryByText("删除集合「精选」？")).toBeNull();

    act(() => {
      p = confirmDialog({ title: "再来一次" });
    });
    fireEvent.click(screen.getByText("取消"));
    await expect(p).resolves.toBe(false);
  });

  it("promptDialog：输入后 Enter 返回 trim 文本；取消返回 null", async () => {
    render(<ConfirmHost />);
    let p!: Promise<string | null>;
    act(() => {
      p = promptDialog({ title: "新建书", placeholder: "书名" });
    });
    const input = screen.getByLabelText("新建书");
    fireEvent.change(input, { target: { value: "  长夜  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await expect(p).resolves.toBe("长夜");

    act(() => {
      p = promptDialog({ title: "改名", initial: "旧名" });
    });
    expect((screen.getByLabelText("改名") as HTMLInputElement).value).toBe("旧名");
    fireEvent.click(screen.getByText("取消"));
    await expect(p).resolves.toBeNull();
  });

  it("Enter 确认、Esc 取消；多个请求排队依次展示", async () => {
    render(<ConfirmHost />);
    let p1!: Promise<boolean>;
    let p2!: Promise<boolean>;
    act(() => {
      p1 = confirmDialog({ title: "第一问" });
      p2 = confirmDialog({ title: "第二问" });
    });
    expect(screen.getByText("第一问")).toBeInTheDocument();
    expect(screen.queryByText("第二问")).toBeNull();
    fireEvent.keyDown(screen.getByText("第一问"), { key: "Enter" });
    await expect(p1).resolves.toBe(true);
    expect(screen.getByText("第二问")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    await expect(p2).resolves.toBe(false);
  });
});
