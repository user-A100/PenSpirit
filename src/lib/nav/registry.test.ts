import { beforeEach, describe, expect, it, vi } from "vitest";
import { PenLine } from "lucide-react";
import { VIEW_STORAGE_KEY } from "./uiStore";

// registry 模块体在 import 时注册内置视图并自愈持久化的视图 id，
// 用 resetModules + 动态 import 获取干净的注册表/存储实例
async function freshNav() {
  vi.resetModules();
  const registry = await import("./registry");
  const { useUiNav } = await import("./uiStore");
  return { registry, useUiNav };
}

describe("navRegistry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("内置注册 write 与 bump 两个一级视图", async () => {
    const { registry, useUiNav } = await freshNav();
    const ids = registry.getViews().map((v) => v.id);
    expect(ids).toEqual(["write", "bump", "read"]);

    const write = registry.getView("write")!;
    expect(write.label).toBe("写作");
    expect(write.icon).toBeDefined();
    expect(write.Component).toBeDefined();
    expect(write.dockPanels.map((p) => p.label)).toEqual(["大纲", "人物", "伏笔", "统计", "文风"]);

    const bump = registry.getView("bump")!;
    expect(bump.label).toBe("碰碰车");
    expect(bump.dockPanels).toEqual([]); // M2-T1 占位，T10 填充
    expect(useUiNav.getState().activeView).toBe("write"); // 自愈无副作用
  });

  it("registerView 按 id 幂等：重复注册不新增，先注册者生效", async () => {
    const { registry } = await freshNav();
    const before = registry.getViews().length;
    const Fake = () => null;
    registry.registerView({
      id: "write",
      label: "假写作",
      icon: PenLine,
      Component: Fake,
      dockPanels: [],
    });
    expect(registry.getViews()).toHaveLength(before);
    expect(registry.getView("write")!.label).toBe("写作");
  });

  it("getViews 返回快照：外部改动不影响注册表", async () => {
    const { registry } = await freshNav();
    const snapshot = registry.getViews() as mutableViews;
    snapshot.pop();
    expect(registry.getViews()).toHaveLength(3);
  });

  it("持久化了未注册的视图 id 时回退 write 并写回存储", async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "bogus");
    const { registry, useUiNav } = await freshNav();
    expect(registry.getView("bogus")).toBeUndefined();
    expect(useUiNav.getState().activeView).toBe("write");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("write");
  });

  it("持久化的视图 id 有效时保持不变", async () => {
    localStorage.setItem(VIEW_STORAGE_KEY, "bump");
    const { useUiNav } = await freshNav();
    expect(useUiNav.getState().activeView).toBe("bump");
    expect(localStorage.getItem(VIEW_STORAGE_KEY)).toBe("bump");
  });
});

// 仅为测试 mutate 快照用（对外类型仍是 readonly）
type mutableViews = import("./registry").NavView[];
