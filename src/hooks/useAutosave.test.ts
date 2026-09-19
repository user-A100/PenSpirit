import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutosave } from "./useAutosave";

describe("useAutosave", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("内容变化 800ms 后触发保存一次", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useAutosave(() => "内容v1", save, 800));
    expect(result.current.status).toBe("idle");
    act(() => { vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("连续变化只保存最后一次内容", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    let text = "a";
    const { result } = renderHook(() => useAutosave(() => text, save, 800));
    act(() => { text = "b"; vi.advanceTimersByTime(500); });
    act(() => { text = "c"; vi.advanceTimersByTime(900); });
    await waitFor(() => expect(result.current.status).toBe("saved"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("c");
  });
});
