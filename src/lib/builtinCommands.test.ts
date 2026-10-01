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
});

function cmds() {
  return builtinCommands();
}
