import { useRef, useState, type PointerEventHandler } from "react";
import { X } from "lucide-react";
import { parseHeadings } from "../../lib/headings";
import { useOutline } from "../../stores/outline";
import { useWorkspace } from "../../stores/workspace";

// M3-T7 悬浮大纲（写作模式，由 ChapterEditor 挂载）：
// 上半「本章」两级小标题 → 点击 request 定位到正文；下半「全书」章节 → 点击切换。
// 头部拖拽：pointerdown 记偏移 → move 改 left/top（视口内钳制）→ 松手 setPos 落
// localStorage；未拖过时用 CSS 默认位（右上 15vh）。视觉三件套见 styles.css。

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), Math.max(min, max));

export function FloatingOutline(props: { markdown: string }) {
  const open = useOutline((s) => s.open);
  const savedLeft = useOutline((s) => s.left);
  const savedTop = useOutline((s) => s.top);
  const chapters = useWorkspace((s) => s.chapters);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);

  const shell = useRef<HTMLElement | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  // 拖拽中的即时位置；松手才落 store（localStorage）
  const [pos, setPos] = useState<{ left: number; top: number } | null>(
    savedLeft != null && savedTop != null ? { left: savedLeft, top: savedTop } : null,
  );

  const headings = parseHeadings(props.markdown);
  if (!open) return null;

  /** 按当前指针坐标算钳制后的浮窗左上角；未在拖拽时回 null */
  const track = (clientX: number, clientY: number) => {
    const el = shell.current;
    const d = drag.current;
    if (!el || !d) return null;
    return {
      left: clamp(clientX - d.dx, 0, window.innerWidth - el.offsetWidth),
      top: clamp(clientY - d.dy, 0, window.innerHeight - el.offsetHeight),
    };
  };

  const onPointerDown: PointerEventHandler<HTMLElement> = (e) => {
    // 关闭按钮不触发拖拽
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = shell.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove: PointerEventHandler<HTMLElement> = (e) => {
    const p = track(e.clientX, e.clientY);
    if (p) setPos(p);
  };

  const onPointerUp: PointerEventHandler<HTMLElement> = (e) => {
    if (!drag.current) return;
    drag.current = null;
    const p = track(e.clientX, e.clientY);
    if (p) {
      setPos(p);
      useOutline.getState().setPos(p.left, p.top);
    }
  };

  return (
    <aside
      ref={shell}
      className="outline-float"
      style={pos ? { left: pos.left, top: pos.top } : undefined}
      role="dialog"
      aria-label="悬浮大纲"
    >
      <div
        className="outline-float-head"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <span className="outline-float-title">大纲</span>
        <button
          onClick={() => useOutline.getState().toggle()}
          title="收起大纲"
          className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <X size={12} />
        </button>
      </div>

      <div className="outline-float-body">
        <div className="outline-sep">本章</div>
        {headings.length === 0 ? (
          <div className="outline-empty">本章无小标题</div>
        ) : (
          <ul className="outline-list">
            {headings.map((h) => (
              <li
                key={`${h.level}:${h.text}`}
                className={h.level === 2 ? "lv2" : undefined}
                title={h.text}
                onClick={() => useOutline.getState().request(h.text)}
              >
                {h.text}
              </li>
            ))}
          </ul>
        )}

        <div className="outline-sep">全书</div>
        <ul className="outline-list">
          {chapters.map((c) => (
            <li
              key={c.id}
              className={c.id === currentChapterId ? "active" : undefined}
              title={c.title}
              onClick={() => {
                // 重复点击当前章不重读正文
                if (c.id !== useWorkspace.getState().currentChapterId)
                  void useWorkspace.getState().selectChapter(c.id);
              }}
            >
              {c.title}
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
