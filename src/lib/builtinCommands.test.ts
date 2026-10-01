import { describe, expect, it } from "vitest";
import { findKeyConflicts } from "./commands";
import { builtinCommands } from "./builtinCommands";

describe("内置命令", () => {
  it("快捷键无冲突、id 唯一", () => {
    const cmds = builtinCommands();
    expect(findKeyConflicts(cmds)).toEqual([]);
    expect(new Set(cmds.map((c) => c.id)).size).toBe(cmds.length);
  });

  it("保留既有快捷键语义（README 已记载）", () => {
    const byKey = new Map(cmds().flatMap((c) => (c.keys ?? []).map((k) => [k, c.id] as const)));
    expect(byKey.get("Mod+B")).toBe("view.toggleSidebar");
    expect(byKey.get("Mod+\\")).toBe("view.toggleDock");
    expect(byKey.get("Alt+O")).toBe("editor.toggleOutline");
    expect(byKey.get("Mod+Shift+F")).toBe("search.open");
    expect(byKey.get("Alt+S")).toBe("editor.cycleSplit");
    expect(byKey.get("Mod+N")).toBe("chapter.new");
  });

  it("阶段 3A：Ctrl+1/2/3 组视图、Ctrl+Shift+E 在目录中定位", () => {
    const byKey = new Map(cmds().flatMap((c) => (c.keys ?? []).map((k) => [k, c.id] as const)));
    expect(byKey.get("Mod+1")).toBe("view.group.scrivenings");
    expect(byKey.get("Mod+2")).toBe("view.group.corkboard");
    expect(byKey.get("Mod+3")).toBe("view.group.outliner");
    expect(byKey.get("Mod+Shift+E")).toBe("binder.reveal");
  });

  it("组视图命令作用于活动窗格，再按一次回单章", async () => {
    const { useWorkspace } = await import("../stores/workspace");
    const { useGroupView } = await import("../stores/groupView");
    const { useUiNav } = await import("./nav/uiStore");
    useWorkspace.setState({ currentBookId: 1, activePane: "b" });
    useUiNav.setState({ activeView: "write" });
    useGroupView.setState({ modes: { a: "single", b: "single" } });
    const run = (id: string) => cmds().find((c) => c.id === id)!.run();
    await run("view.group.corkboard");
    expect(useGroupView.getState().modes).toEqual({ a: "single", b: "corkboard" });
    await run("view.group.outliner");
    expect(useGroupView.getState().modes.b).toBe("outliner");
    await run("view.group.outliner");
    expect(useGroupView.getState().modes.b).toBe("single");
  });
});

function cmds() {
  return builtinCommands();
}
