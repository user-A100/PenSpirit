import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadSidebarPct,
  saveSidebarPct,
  SIDEBAR_PCT_KEY,
  useUiNav,
  VIEW_STORAGE_KEY,
} from "./uiStore";

// uiStore 初值在模块加载时读取 localStorage，用 resetModules + 动态 import 取新实例
async function freshStore() {
  vi.resetModules();
  return import("./uiStore");
}

describe("uiNav store", () => {
  beforeEach(() => {
    localStorage.clear();
    useUiNav.setState({ activeView: "write", sidebarCollapsed: false });
  });

  it("无持久化时初值为写作视图、侧栏展开", async () => {
    const { useUiNav: fresh } = await freshStore();
    expect(fresh.getState().activeView).toBe("write");
    expect(fresh.getState().sidebarCollapsed).toBe(false);
  });

  it("存储值为空串（无效）时回退 write", async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "");
    const { useUiNav: fresh } = await freshStore();
    expect(fresh.getState().activeView).toBe("write");
  });

  it("存储值有效时按持久化恢复", async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "bump");
    const { useUiNav: fresh } = await freshStore();
    expect(fresh.getState().activeView).toBe("bump");
  });

  it("setView 切换视图并持久化到 localStorage", () => {
    useUiNav.getState().setView("bump");
    expect(useUiNav.getState().activeView).toBe("bump");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("bump");

    useUiNav.getState().setView("write");
    expect(useUiNav.getState().activeView).toBe("write");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("write");
  });

  it("setView 在 localStorage 不可写时不抛错、状态仍更新", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => useUiNav.getState().setView("bump")).not.toThrow();
    expect(useUiNav.getState().activeView).toBe("bump");
    spy.mockRestore();
  });

  it("toggleSidebar 翻转侧栏折叠状态", () => {
    expect(useUiNav.getState().sidebarCollapsed).toBe(false);
    useUiNav.getState().toggleSidebar();
    expect(useUiNav.getState().sidebarCollapsed).toBe(true);
    useUiNav.getState().toggleSidebar();
    expect(useUiNav.getState().sidebarCollapsed).toBe(false);
  });

  it("sidebarPct 记忆：存取往返、非法值返回 null", () => {
    expect(loadSidebarPct()).toBeNull();

    saveSidebarPct(22.5);
    expect(loadSidebarPct()).toBe(22.5);

    localStorage.setItem(SIDEBAR_PCT_KEY, "abc");
    expect(loadSidebarPct()).toBeNull();

    localStorage.setItem(SIDEBAR_PCT_KEY, "0"); // 折叠态的 0 不作为宽度恢复
    expect(loadSidebarPct()).toBeNull();
  });
});
