import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadDockPct,
  loadSidebarPct,
  saveDockPct,
  saveSidebarPct,
  DOCK_PCT_KEY,
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
    useUiNav.setState({ activeView: "write", sidebarCollapsed: false, dockCollapsed: false });
  });

  it("无持久化时初值为写作视图、侧栏与 dock 展开", async () => {
    const { useUiNav: fresh } = await freshStore();
    expect(fresh.getState().activeView).toBe("write");
    expect(fresh.getState().sidebarCollapsed).toBe(false);
    expect(fresh.getState().dockCollapsed).toBe(false);
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

  it("toggleDock 翻转 dock 折叠状态", () => {
    expect(useUiNav.getState().dockCollapsed).toBe(false);
    useUiNav.getState().toggleDock();
    expect(useUiNav.getState().dockCollapsed).toBe(true);
    useUiNav.getState().toggleDock();
    expect(useUiNav.getState().dockCollapsed).toBe(false);
  });

  it("dockPct 记忆：存取往返、非法值返回 null", () => {
    expect(loadDockPct()).toBeNull();

    saveDockPct(24);
    expect(loadDockPct()).toBe(24);

    localStorage.setItem(DOCK_PCT_KEY, "abc");
    expect(loadDockPct()).toBeNull();

    // 有效域 17-34 开区间：折叠态 0 与 min/max 边界值均不作为宽度恢复
    localStorage.setItem(DOCK_PCT_KEY, "0");
    expect(loadDockPct()).toBeNull();

    localStorage.setItem(DOCK_PCT_KEY, "17");
    expect(loadDockPct()).toBeNull();

    localStorage.setItem(DOCK_PCT_KEY, "34");
    expect(loadDockPct()).toBeNull();
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
