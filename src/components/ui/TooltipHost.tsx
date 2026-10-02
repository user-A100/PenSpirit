import { useEffect, useRef, useState } from "react";

// 全局提示气泡（替代原生 title，样式随主题、带快捷键胶囊）：
// 任意元素加 data-tip="文案"（可选 data-tip-key="Ctrl+B"、data-tip-side="right|left|top|bottom"），
// 悬停 450ms / 键盘聚焦即显示；按下、滚动、离开即收起。宿主挂 App 根部一次，事件委托，零包装。

const DELAY = 450;
const GAP = 8;

type Side = "right" | "left" | "top" | "bottom";

interface TipState {
  text: string;
  keys: string | null;
  rect: DOMRect;
  side: Side;
}

function findTip(el: EventTarget | null): HTMLElement | null {
  return el instanceof Element ? (el.closest("[data-tip]") as HTMLElement | null) : null;
}

export function TooltipHost() {
  const [tip, setTip] = useState<TipState | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const current = useRef<HTMLElement | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const show = (el: HTMLElement, immediate: boolean) => {
      window.clearTimeout(timer.current);
      current.current = el;
      const open = () => {
        if (current.current !== el || !document.contains(el)) return;
        const text = el.getAttribute("data-tip");
        if (!text) return;
        setPos(null);
        setTip({
          text,
          keys: el.getAttribute("data-tip-key"),
          rect: el.getBoundingClientRect(),
          side: (el.getAttribute("data-tip-side") as Side | null) ?? "bottom",
        });
      };
      if (immediate) open();
      else timer.current = window.setTimeout(open, DELAY);
    };
    const hide = () => {
      window.clearTimeout(timer.current);
      current.current = null;
      setTip(null);
    };
    const onOver = (e: PointerEvent) => {
      const el = findTip(e.target);
      if (el === current.current) return;
      if (el) show(el, false);
      else hide();
    };
    const onFocus = (e: FocusEvent) => {
      const el = findTip(e.target);
      // 只有键盘聚焦（:focus-visible）才即时提示，鼠标点击不弹
      if (el && el.matches(":focus-visible")) show(el, true);
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // 量出气泡尺寸后定位；越界时翻到对侧并夹在视口内
  useEffect(() => {
    if (!tip || !boxRef.current) return;
    const b = boxRef.current.getBoundingClientRect();
    const r = tip.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let side = tip.side;
    if (side === "right" && r.right + GAP + b.width > vw) side = "left";
    else if (side === "left" && r.left - GAP - b.width < 0) side = "right";
    else if (side === "bottom" && r.bottom + GAP + b.height > vh) side = "top";
    else if (side === "top" && r.top - GAP - b.height < 0) side = "bottom";
    let left: number;
    let top: number;
    if (side === "right" || side === "left") {
      left = side === "right" ? r.right + GAP : r.left - GAP - b.width;
      top = r.top + r.height / 2 - b.height / 2;
    } else {
      left = r.left + r.width / 2 - b.width / 2;
      top = side === "bottom" ? r.bottom + GAP : r.top - GAP - b.height;
    }
    left = Math.max(6, Math.min(vw - b.width - 6, left));
    top = Math.max(6, Math.min(vh - b.height - 6, top));
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      role="tooltip"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? "visible" : "hidden" }}
      className="tooltip-in pointer-events-none fixed z-[320] flex max-w-[18rem] items-center gap-2 rounded-[var(--r-control)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] [box-shadow:var(--shadow-overlay)]"
    >
      <span>{tip.text}</span>
      {tip.keys && (
        <kbd className="rounded-[4px] px-1 font-sans text-2xs text-[color:var(--text-faint)] [box-shadow:inset_0_0_0_1px_var(--hairline)]">
          {tip.keys}
        </kbd>
      )}
    </div>
  );
}
