import { beforeEach, describe, expect, it, vi } from "vitest";

// kv 经 src/lib/tauri.ts 的 api.settingGet/Set 走 invoke——在这里 mock 掉最底层
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { kvGet, kvSet } from "./kv";

const mockInvoke = vi.mocked(invoke);

describe("kv 封装", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("kvSet 把值 JSON 序列化后走 setting_set", async () => {
    mockInvoke.mockResolvedValue(null);
    await kvSet("read:progress:1", { chapter_id: 2, scroll_ratio: 0.5, ts: 123 });
    expect(mockInvoke).toHaveBeenCalledWith("setting_set", {
      key: "read:progress:1",
      value: '{"chapter_id":2,"scroll_ratio":0.5,"ts":123}',
    });
  });

  it("kvSet 对字符串值同样做 JSON 往返", async () => {
    mockInvoke.mockResolvedValue(null);
    await kvSet("k", "hello");
    expect(mockInvoke).toHaveBeenCalledWith("setting_set", { key: "k", value: '"hello"' });
  });

  it("kvGet 反序列化 setting_get 返回的 JSON，并传对 key", async () => {
    mockInvoke.mockResolvedValue('{"a":1,"b":"x"}');
    expect(await kvGet<{ a: number; b: string }>("k")).toEqual({ a: 1, b: "x" });
    expect(mockInvoke).toHaveBeenCalledWith("setting_get", { key: "k" });
  });

  it("kvGet 原始字符串值往返", async () => {
    mockInvoke.mockResolvedValue('"hello"');
    expect(await kvGet<string>("k")).toBe("hello");
  });

  it("kvGet 无记录（null）返回 null", async () => {
    mockInvoke.mockResolvedValue(null);
    expect(await kvGet("k")).toBeNull();
  });

  it("kvGet 坏 JSON 返回 null 而不是抛错", async () => {
    mockInvoke.mockResolvedValue("{oops");
    expect(await kvGet("k")).toBeNull();
  });
});
