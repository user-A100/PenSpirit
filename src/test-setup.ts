import "@testing-library/jest-dom/vitest";
import { act, configure } from "@testing-library/react";
import { vi } from "vitest";

// @testing-library 的 waitFor 只通过 `jest` 全局识别 fake timers；
// vitest 的 fake timers 同为 sinon 风格（faked setTimeout 带 .clock 特征），
// 这里桥接 vitest，使 waitFor 在 fake timers 下按 50ms 步进推进而不是挂死。
const globalAny = globalThis as { jest?: unknown };
if (globalAny.jest === undefined) {
  globalAny.jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
    advanceTimersByTimeAsync: (ms: number) => vi.advanceTimersByTimeAsync(ms),
    isMockFunction: (fn: unknown) =>
      typeof fn === "function" &&
      (fn as { _isMockFunction?: boolean })._isMockFunction === true,
  };
}

configure({
  // fake timers 下 waitFor 的定时推进包一层 act，保证 React 状态更新被 flush
  unstable_advanceTimersWrapper: (cb) => act(cb),
});
