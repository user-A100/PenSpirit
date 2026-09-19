import { beforeEach, describe, expect, it, vi } from "vitest";
import { OUTLINE_STORAGE_KEY, useOutline } from "./outline";

// M3-T7 悬浮大纲 store：open/浮窗位置持久化 localStorage，
// jumpTarget 为一次性通道（request 写入 → 编辑器 consume 取走并清空）。

describe("outline store", () => {
  beforeEach(() => {
    localStorage.clear();
    useOutline.setState({ open: false, left: null, top: null, jumpTarget: null });
  });

  it("request/consume 一次性语义：取走即清空，再取为 null", () => {
    useOutline.getState().request("第十二章 风雪夜");
    expect(useOutline.getState().jumpTarget).toBe("第十二章 风雪夜");

    expect(useOutline.getState().consume()).toBe("第十二章 风雪夜");
    expect(useOutline.getState().jumpTarget).toBeNull();
    expect(useOutline.getState().consume()).toBeNull();
  });

  it("request 覆盖上一个待跳转文本", () => {
    useOutline.getState().request("旧标题");
    useOutline.getState().request("新标题");
    expect(useOutline.getState().consume()).toBe("新标题");
  });

  it("toggle 翻转 open 并连同位置一起持久化", () => {
    useOutline.getState().toggle();
    expect(useOutline.getState().open).toBe(true);
    expect(JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY)!)).toEqual({
      open: true,
      left: null,
      top: null,
    });

    useOutline.getState().toggle();
    expect(useOutline.getState().open).toBe(false);
    expect(JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY)!).open).toBe(false);
  });

  it("setPos 记录拖拽落点并持久化（保留 open）", () => {
    useOutline.getState().toggle(); // open: true
    useOutline.getState().setPos(120, 80);

    const s = useOutline.getState();
    expect(s.left).toBe(120);
    expect(s.top).toBe(80);
    expect(s.open).toBe(true);
    expect(JSON.parse(localStorage.getItem(OUTLINE_STORAGE_KEY)!)).toEqual({
      open: true,
      left: 120,
      top: 80,
    });
  });

  it("open 与位置初值从 localStorage 读取（模块加载时）", async () => {
    localStorage.setItem(OUTLINE_STORAGE_KEY, JSON.stringify({ open: true, left: 10, top: 20 }));
    vi.resetModules();
    const { useOutline: fresh } = await import("./outline");
    expect(fresh.getState().open).toBe(true);
    expect(fresh.getState().left).toBe(10);
    expect(fresh.getState().top).toBe(20);
  });

  it("localStorage 残留非法 JSON 时回退默认（关/无位置）", async () => {
    localStorage.setItem(OUTLINE_STORAGE_KEY, "{{{not json");
    vi.resetModules();
    const { useOutline: fresh } = await import("./outline");
    expect(fresh.getState().open).toBe(false);
    expect(fresh.getState().left).toBeNull();
    expect(fresh.getState().top).toBeNull();
  });

  it("localStorage 不可写时 toggle 不抛错，会话内仍生效", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => useOutline.getState().toggle()).not.toThrow();
    expect(useOutline.getState().open).toBe(true);
    spy.mockRestore();
  });
});
