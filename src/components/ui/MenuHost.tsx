import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { useMenu, type MenuEntry, type MenuRequest } from "../../stores/menu";

// 菜单宿主：右键/下拉共用。键盘：↑↓ 移动、Home/End、Enter/Space 执行、→ 进子菜单、
// ← / Esc 退回上一级（根级 Esc 关闭）；鼠标悬停 120ms 展开子菜单；
// 越界自动翻转（根菜单翻到指针/锚点上方或左侧，子菜单翻到父菜单左侧）。
// 关闭后焦点还给打开前的元素；菜单项动作在关闭后的下一拍执行（可安全转移焦点）。

const EDGE = 6;
const SUBMENU_DELAY = 120;

type ItemEntry = Extract<MenuEntry, { label: string; type?: "item" }>;

function isItem(e: MenuEntry | undefined): e is ItemEntry {
  return e != null && e.type !== "separator" && e.type !== "label";
}

function selectable(e: MenuEntry | undefined): boolean {
  return isItem(e) && !e.disabled;
}

interface PanelProps {
  items: MenuEntry[];
  x: number;
  y: number;
  anchor?: MenuRequest["anchor"];
  alignEnd?: boolean;
  minWidth?: number;
  depth: number;
  autoFocus: boolean;
  onClose: () => void;
  /** 子菜单向左退出（← / Esc） */
  onExit?: () => void;
}

function MenuPanel({ items, x, y, anchor, alignEnd, minWidth, depth, autoFocus, onClose, onExit }: PanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState(-1);
  const [sub, setSub] = useState<{ index: number; viaKey: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = alignEnd ? x - w : x;
    let top = y;
    if (left + w > vw - EDGE) left = depth > 0 && anchor ? anchor.left - w : vw - EDGE - w;
    if (left < EDGE) left = EDGE;
    if (top + h > vh - EDGE) top = depth === 0 && anchor ? anchor.top - h - 4 : vh - EDGE - h;
    if (top < EDGE) top = EDGE;
    setPos({ left, top });
    if (autoFocus) {
      el.focus({ preventScroll: true });
      const first = items.findIndex(selectable);
      if (depth > 0 && first >= 0) setActive(first);
    }
    // 只在挂载时定位一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  const move = (dir: 1 | -1) => {
    if (!items.some(selectable)) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (selectable(items[i])) {
        setActive(i);
        return;
      }
    }
  };

  const activate = (i: number, viaKey: boolean) => {
    const it = items[i];
    if (!isItem(it) || it.disabled) return;
    if (it.submenu) {
      setSub({ index: i, viaKey });
      return;
    }
    onClose();
    if (it.onSelect) window.setTimeout(it.onSelect, 0);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 子菜单持有焦点时由它处理
    if (e.target !== ref.current) return;
    let handled = true;
    switch (e.key) {
      case "ArrowDown":
        move(1);
        break;
      case "ArrowUp":
        move(-1);
        break;
      case "Home":
        setActive(items.findIndex(selectable));
        break;
      case "End": {
        let i = items.length - 1;
        while (i >= 0 && !selectable(items[i])) i--;
        setActive(i);
        break;
      }
      case "Enter":
      case " ":
        if (active >= 0) activate(active, true);
        break;
      case "ArrowRight":
        if (active >= 0 && isItem(items[active]) && (items[active] as ItemEntry).submenu) activate(active, true);
        break;
      case "ArrowLeft":
        if (depth > 0) onExit?.();
        else handled = false;
        break;
      case "Escape":
        if (depth > 0) onExit?.();
        else onClose();
        break;
      case "Tab":
        break; // 菜单内不让 Tab 跑出去
      default:
        handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const subItem = sub != null ? items[sub.index] : undefined;
  const subRect = sub != null ? itemRefs.current[sub.index]?.getBoundingClientRect() : undefined;
  const panelRect = ref.current?.getBoundingClientRect();

  return (
    <>
      <div
        ref={ref}
        role="menu"
        tabIndex={-1}
        data-menu-panel=""
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          left: pos?.left ?? x,
          top: pos?.top ?? y,
          minWidth: minWidth ?? 176,
          // 定位前用透明而非 visibility:hidden——隐藏元素无法获得焦点，键盘导航会失效
          opacity: pos ? undefined : 0,
          pointerEvents: pos ? undefined : "none",
        }}
        className="menu-pop fixed z-[260] max-h-[70vh] max-w-[20rem] overflow-y-auto rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-1 text-ui outline-none [box-shadow:var(--shadow-overlay,0_10px_30px_rgba(0,0,0,0.3))]"
      >
        {items.map((it, i) => {
          if (it.type === "separator") {
            return <div key={i} role="separator" className="mx-1.5 my-1 h-px bg-[var(--border-subtle)]" />;
          }
          if (it.type === "label") {
            return (
              <div key={i} className="px-2.5 pb-0.5 pt-1.5 text-2xs text-[color:var(--text-faint)]">
                {it.label}
              </div>
            );
          }
          const Icon = it.icon;
          const isActive = i === active;
          return (
            <div
              key={i}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              aria-haspopup={it.submenu ? "menu" : undefined}
              aria-expanded={it.submenu ? sub?.index === i : undefined}
              onMouseEnter={() => {
                if (it.disabled) return;
                setActive(i);
                window.clearTimeout(hoverTimer.current);
                hoverTimer.current = window.setTimeout(() => {
                  setSub(it.submenu ? { index: i, viaKey: false } : null);
                }, SUBMENU_DELAY);
              }}
              onClick={(e) => {
                e.stopPropagation();
                activate(i, false);
              }}
              className={`flex cursor-default select-none items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 ${
                it.disabled
                  ? "text-[color:var(--text-faint)]"
                  : it.danger
                    ? `text-[color:var(--danger)] ${isActive ? "bg-[var(--bg-hover)]" : ""}`
                    : `text-[color:var(--text-primary)] ${isActive ? "bg-[var(--bg-hover)]" : ""}`
              }`}
            >
              <span className="flex w-4 shrink-0 items-center justify-center">
                {it.checked ? (
                  <Check size={14} />
                ) : it.swatch ? (
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: it.swatch }} />
                ) : Icon ? (
                  <Icon size={14} className={it.danger ? "" : "text-[color:var(--text-secondary)]"} />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.shortcut && (
                <span className="shrink-0 pl-4 text-2xs text-[color:var(--text-faint)]">{it.shortcut}</span>
              )}
              {it.submenu && <ChevronRight size={13} className="shrink-0 text-[color:var(--text-faint)]" />}
            </div>
          );
        })}
      </div>
      {isItem(subItem) && subItem.submenu && subRect && (
        <MenuPanel
          key={sub!.index}
          items={subItem.submenu}
          x={subRect.right + 2}
          y={subRect.top - 5}
          anchor={{
            top: subRect.top,
            bottom: subRect.bottom,
            left: panelRect?.left ?? subRect.left,
            right: subRect.right,
          }}
          depth={depth + 1}
          autoFocus={sub!.viaKey}
          onClose={onClose}
          onExit={() => {
            setSub(null);
            ref.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </>
  );
}

/** 全局菜单宿主：挂在 App 根部一次 */
export function MenuHost() {
  const req = useMenu((s) => s.req);
  const seq = useMenu((s) => s.seq);
  const close = useMenu((s) => s.close);

  useEffect(() => {
    if (!req) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("[data-menu-panel]")) close(false);
    };
    const onDismiss = () => close(false);
    // 兜底：焦点不在菜单里时 Esc 也能关（面板自己的 Esc 处理会先拦截）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("keydown", onKey);
      if (useMenu.getState().restoreFocus && prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
  }, [req, close]);

  if (!req) return null;
  return (
    <MenuPanel
      key={seq}
      items={req.items}
      x={req.x}
      y={req.y}
      anchor={req.anchor}
      alignEnd={req.alignEnd}
      minWidth={req.minWidth}
      depth={0}
      autoFocus
      onClose={() => close()}
    />
  );
}
