import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "./Toaster";
import { TOAST_MAX, toast, useToasts } from "../../stores/toast";

beforeEach(() => {
  vi.useFakeTimers();
  useToasts.getState().clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Toaster", () => {
  it("到时自动消失；悬停期间暂停计时", () => {
    render(<Toaster />);
    act(() => {
      toast.info("已保存", { duration: 1000 });
    });
    const el = screen.getByText("已保存").closest("[data-testid=toast]") as HTMLElement;
    fireEvent.mouseEnter(el);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText("已保存")).toBeInTheDocument();
    fireEvent.mouseLeave(el);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    act(() => {
      vi.advanceTimersByTime(200); // 退场动画
    });
    expect(screen.queryByText("已保存")).toBeNull();
  });

  it("动作按钮执行回调并关闭", async () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast.info("已移到回收站", { action: { label: "撤销", run: undo } });
    });
    await act(async () => {
      fireEvent.click(screen.getByText("撤销"));
    });
    expect(undo).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.queryByText("已移到回收站")).toBeNull();
  });

  it("同屏最多 TOAST_MAX 条，挤掉最早的", () => {
    for (let i = 0; i < TOAST_MAX + 2; i++) toast.info(`第${i}条`);
    const msgs = useToasts.getState().toasts.map((t) => t.message);
    expect(msgs).toHaveLength(TOAST_MAX);
    expect(msgs[0]).toBe("第2条");
  });
});
