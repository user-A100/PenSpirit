// 命令中枢（阶段 0）：命令 = {id, 标题, 快捷键, 可用条件, 执行}。
// 一处注册，多处消费：全局快捷键分发、命令面板、右键菜单快捷键提示、快捷键速查。
// 叶子模块，不依赖任何 store，避免循环引用；内置命令在 builtinCommands.ts 注册。

export interface Command {
  id: string;
  title: string;
  /** 命令面板分组 */
  category?: string;
  /** 组合键，如 "Mod+B"、"Alt+ArrowLeft"、"Mod+Shift+F"；Mod = Ctrl（mac 为 Cmd） */
  keys?: string[];
  /** 可用条件；返回 false 时快捷键不拦截、面板置灰 */
  when?: () => boolean;
  run: () => void | Promise<void>;
  /** 有模态框打开时仍响应快捷键（默认不响应） */
  allowInModal?: boolean;
}

const registry = new Map<string, Command>();
const subscribers = new Set<() => void>();

function emit() {
  for (const fn of subscribers) fn();
}

export function registerCommand(cmd: Command): () => void {
  registry.set(cmd.id, cmd);
  emit();
  return () => {
    if (registry.get(cmd.id) === cmd) {
      registry.delete(cmd.id);
      emit();
    }
  };
}

export function registerCommands(cmds: Command[]): () => void {
  const offs = cmds.map(registerCommand);
  return () => offs.forEach((off) => off());
}

export function getCommands(): Command[] {
  return [...registry.values()];
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function subscribeCommands(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/** 执行命令；不存在或不可用返回 false */
export function runCommand(id: string): boolean {
  const c = registry.get(id);
  if (!c || (c.when && !c.when())) return false;
  void Promise.resolve()
    .then(() => c.run())
    .catch((err) => console.error(`命令 ${id} 执行失败`, err));
  return true;
}

const KEY_ALIAS: Record<string, string> = {
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  enter: "Enter",
  space: "Space",
  " ": "Space",
  tab: "Tab",
  backspace: "Backspace",
};

function normKey(k: string): string {
  if (k.length === 1) return k.toUpperCase();
  const alias = KEY_ALIAS[k.toLowerCase()];
  if (alias) return alias;
  return k[0].toUpperCase() + k.slice(1);
}

/** 规范化组合键："mod+shift+f" → "Mod+Shift+F"（修饰键固定顺序 Mod, Alt, Shift） */
export function normalizeCombo(combo: string): string {
  // "+" 本身作为键时写成 "Mod+Plus"，这里不支持裸 "+"
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop() ?? "";
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  const out: string[] = [];
  if (mods.has("mod") || mods.has("ctrl") || mods.has("cmd") || mods.has("meta")) out.push("Mod");
  if (mods.has("alt")) out.push("Alt");
  if (mods.has("shift")) out.push("Shift");
  out.push(normKey(key));
  return out.join("+");
}

const CODE_KEY: Record<string, string> = {
  Backslash: "\\",
  Slash: "/",
  BracketLeft: "[",
  BracketRight: "]",
  Comma: ",",
  Period: ".",
  Semicolon: ";",
  Quote: "'",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
};

/** 键盘事件 → 规范组合键；纯修饰键返回 null。物理键优先（Shift/输入法不改变结果） */
export function eventCombo(e: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string | null {
  if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") return null;
  const out: string[] = [];
  if (e.ctrlKey || e.metaKey) out.push("Mod");
  if (e.altKey) out.push("Alt");
  if (e.shiftKey) out.push("Shift");
  let key = e.key;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_KEY[e.code]) key = CODE_KEY[e.code];
  out.push(normKey(key));
  return out.join("+");
}

/** 展示用：Mod → Ctrl，方向键 → 箭头符号 */
export function formatCombo(combo: string): string {
  return normalizeCombo(combo)
    .replace(/^Mod\b/, "Ctrl")
    .replace("ArrowLeft", "←")
    .replace("ArrowRight", "→")
    .replace("ArrowUp", "↑")
    .replace("ArrowDown", "↓")
    .replace("Escape", "Esc");
}

/** 命令的首个快捷键展示文案（无则空串） */
export function commandShortcut(id: string): string {
  const k = registry.get(id)?.keys?.[0];
  return k ? formatCombo(k) : "";
}

/** 同一组合键被多个命令占用的冲突清单（测试与开发期自检用） */
export function findKeyConflicts(cmds: Command[] = getCommands()): string[] {
  const seen = new Map<string, string>();
  const conflicts: string[] = [];
  for (const c of cmds) {
    for (const k of c.keys ?? []) {
      const n = normalizeCombo(k);
      const prev = seen.get(n);
      if (prev && prev !== c.id) conflicts.push(`${n}: ${prev} / ${c.id}`);
      else seen.set(n, c.id);
    }
  }
  return conflicts;
}

function modalOpen(): boolean {
  return document.querySelector('[aria-modal="true"]') != null;
}

/**
 * 安装全局快捷键分发（捕获阶段）：命中注册的组合键即执行并拦截事件，
 * 因此全局快捷键优先于编辑器内置键位（如 Ctrl+B 是「折叠侧栏」而非加粗）。
 * 输入法组字中的按键一律放行。
 */
export function installKeyDispatcher(target: Window = window): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.isComposing || e.keyCode === 229) return;
    const combo = eventCombo(e);
    if (!combo) return;
    for (const c of registry.values()) {
      if (!c.keys?.some((k) => normalizeCombo(k) === combo)) continue;
      if (!c.allowInModal && modalOpen()) continue;
      if (c.when && !c.when()) continue;
      e.preventDefault();
      e.stopPropagation();
      void Promise.resolve()
        .then(() => c.run())
        .catch((err) => console.error(`命令 ${c.id} 执行失败`, err));
      return;
    }
  };
  target.addEventListener("keydown", onKey, true);
  return () => target.removeEventListener("keydown", onKey, true);
}
