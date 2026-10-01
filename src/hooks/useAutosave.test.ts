import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("内容变化 800ms 后触发保存一次", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(() => 1, () => "内容v1", save, 800));
    expect(result.current.status).toBe("idle");
    act(() => { vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("连续变化只保存最后一次内容", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let text = "a";
    let version = 1;
    const { result, rerender } = renderHook(() => useAutosave(() => version, () => text, save, 800));
    act(() => { text = "b"; version++; vi.advanceTimersByTime(500); });
    rerender();
    act(() => { text = "c"; version++; vi.advanceTimersByTime(500); });
    rerender();
    act(() => { vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c");
  });

  it("版本号不变时重渲染不重置防抖、也不取内容（长章按键不再每次整篇序列化）", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const getDirty = vi.fn(() => "x");
    const { result, rerender } = renderHook(() => useAutosave(() => 7, getDirty, save, 800));
    act(() => { vi.advanceTimersByTime(500); });
    rerender();
    rerender();
    expect(getDirty).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(getDirty).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("x");
  });

  it("卸载时冲刷防抖窗口内的改动", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => useAutosave(() => 1, () => "未保存", save, 800));
    unmount();
    expect(save).toHaveBeenCalledWith("未保存");
  });
});
