import { useCallback, useEffect, useRef, useState } from "react";

// 图谱/地图共用的平移缩放（M5-T4）：wheel 以光标为中心缩放（0.1~8），
// 左键拖拽平移。wheel 必须挂原生 { passive: false } 才能阻止页面滚动
// （React 合成 onWheel 在 root 上是 passive 的）。
// 子元素自带拖拽（如地图 pin）时在自身 onPointerDown 里 stopPropagation。
export function usePanZoom() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setT((p) => {
        const k = Math.min(8, Math.max(0.1, p.k * Math.exp(-e.deltaY * 0.0015)));
        const s = k / p.k;
        return { k, x: cx - (cx - p.x) * s, y: cy - (cy - p.y) * s };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, ox: t.x, oy: t.y };
  }, [t.x, t.y]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setT((p) => ({ ...p, x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }));
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
  }, []);

  const reset = useCallback(() => setT({ x: 0, y: 0, k: 1 }), []);

  return { ref, t, onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerLeave: endDrag, reset };
}
