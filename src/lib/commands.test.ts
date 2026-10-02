import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventCombo,
  findKeyConflicts,
  formatCombo,
  getCommands,
  installKeyDispatcher,
  normalizeCombo,
  registerCommand,
  runCommand,
} from "./commands";

const offs: Array<() => void> = [];
afterEach(() => {
  while (offs.length) offs.pop()!();
  document.body.innerHTML = "";
});

function key(init: KeyboardEventInit & { code?: string }) {
  return new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
}

describe("组合键规范化", () => {
  it("修饰键顺序与别名", () => {
    expect(normalizeCombo("shift+mod+f")).toBe("Mod+Shift+F");
    expect(normalizeCombo("Ctrl+\\")).toBe("Mod+\\");
    expect(normalizeCombo("alt+left")).toBe("Alt+ArrowLeft");
    expect(formatCombo("Mod+Shift+F")).toBe("Ctrl+Shift+F");
    expect(formatCombo("Alt+ArrowLeft")).toBe("Alt+←");
  });

  it("事件按物理键取值（Shift 不改变字母）", () => {
    expect(eventCombo(key({ key: "F", code: "KeyF", ctrlKey: true, shiftKey: true }))).toBe("Mod+Shift+F");
    expect(eventCombo(key({ key: "\\", code: "Backslash", ctrlKey: true }))).toBe("Mod+\\");
    expect(eventCombo(key({ key: "Control", code: "ControlLeft", ctrlKey: true }))).toBeNull();
  });
});

describe("注册与分发", () => {
  it("命中快捷键执行并拦截；when=false 放行", async () => {
    const run = vi.fn();
    let enabled = true;
    offs.push(registerCommand({ id: "t.a", title: "A", keys: ["Mod+K"], when: () => enabled, run }));
    offs.push(installKeyDispatcher());

    const e1 = key({ key: "k", code: "KeyK", ctrlKey: true });
    window.dispatchEvent(e1);
    await Promise.resolve();
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(e1.defaultPrevented).toBe(true);

    enabled = false;
    const e2 = key({ key: "k", code: "KeyK", ctrlKey: true });
    window.dispatchEvent(e2);
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    expect(e2.defaultPrevented).toBe(false);
  });

  it("输入法组字中不触发", async () => {
    const run = vi.fn();
    offs.push(registerCommand({ id: "t.b", title: "B", keys: ["Mod+N"], run }));
    offs.push(installKeyDispatcher());
    window.dispatchEvent(key({ key: "n", code: "KeyN", ctrlKey: true, isComposing: true }));
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });

  it("模态框打开时默认不响应", async () => {
    const run = vi.fn();
    offs.push(registerCommand({ id: "t.c", title: "C", keys: ["Mod+J"], run }));
    offs.push(installKeyDispatcher());
    const dlg = document.createElement("div");
    dlg.setAttribute("aria-modal", "true");
    document.body.appendChild(dlg);
    window.dispatchEvent(key({ key: "j", code: "KeyJ", ctrlKey: true }));
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });

  it("runCommand 与注销", () => {
    const run = vi.fn();
    const off = registerCommand({ id: "t.d", title: "D", run });
    expect(runCommand("t.d")).toBe(true);
    off();
    expect(runCommand("t.d")).toBe(false);
    expect(getCommands().some((c) => c.id === "t.d")).toBe(false);
  });

  it("冲突检测", () => {
    expect(
      findKeyConflicts([
        { id: "x", title: "x", keys: ["Mod+B"], run: () => {} },
        { id: "y", title: "y", keys: ["ctrl+b"], run: () => {} },
      ]),
    ).toEqual(["Mod+B: x / y"]);
  });
});
