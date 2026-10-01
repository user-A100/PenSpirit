import { create } from "zustand";
import type { LucideIcon } from "lucide-react";

// 菜单原语的状态：全局同一时刻只开一个菜单（右键菜单 / 下拉菜单共用一个宿主 <MenuHost />）。

export type MenuEntry =
  | {
      type?: "item";
      label: string;
      icon?: LucideIcon;
      /** 右侧快捷键提示（展示用，如 "F2"） */
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      /** 单选/勾选态（显示 ✓） */
      checked?: boolean;
      /** 色点（标签颜色等） */
      swatch?: string;
      onSelect?: () => void;
      submenu?: MenuEntry[];
    }
  | { type: "separator" }
  | { type: "label"; label: string };

export interface MenuRequest {
  x: number;
  y: number;
  items: MenuEntry[];
  /** 下拉菜单锚点：下方放不下时翻到锚点上方 */
  anchor?: { top: number; bottom: number; left: number; right: number };
  /** 右对齐到 x（下拉菜单贴锚点右边缘） */
  alignEnd?: boolean;
  minWidth?: number;
}

interface MenuState {
  req: MenuRequest | null;
  /** 每次打开自增，作为面板 key 让同位置重开也重置内部状态 */
  seq: number;
  /** 关闭后是否把焦点还给打开前的元素（Esc / 选中项 = 是；点菜单外 = 否，焦点留在用户点的地方） */
  restoreFocus: boolean;
  open: (req: MenuRequest) => void;
  close: (restoreFocus?: boolean) => void;
}

export const useMenu = create<MenuState>((set) => ({
  req: null,
  seq: 0,
  restoreFocus: true,
  open: (req) => set((s) => ({ req, seq: s.seq + 1, restoreFocus: true })),
  close: (restoreFocus = true) => set({ req: null, restoreFocus }),
}));

type PointerLike = { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void };

/** 右键菜单：在指针处打开 */
export function openContextMenu(e: PointerLike, items: MenuEntry[]): void {
  e.preventDefault();
  e.stopPropagation();
  useMenu.getState().open({ x: e.clientX, y: e.clientY, items });
}

/** 下拉菜单：贴在元素下方（align=end 时右边缘对齐） */
export function openMenuAt(el: Element, items: MenuEntry[], align: "start" | "end" = "start"): void {
  const r = el.getBoundingClientRect();
  useMenu.getState().open({
    x: align === "start" ? r.left : r.right,
    y: r.bottom + 4,
    items,
    anchor: { top: r.top, bottom: r.bottom, left: r.left, right: r.right },
    alignEnd: align === "end",
    minWidth: Math.max(160, r.width),
  });
}

export function closeMenu(): void {
  useMenu.getState().close();
}
