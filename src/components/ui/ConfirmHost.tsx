import { useEffect, useRef } from "react";
import { useConfirmStore } from "../../stores/confirm";
import { Modal } from "./Modal";
import { Button } from "./Button";

/** 确认框宿主：一次展示队首一条；Enter 确认、Esc/点遮罩取消 */
export function ConfirmHost() {
  const req = useConfirmStore((s) => s.queue[0] ?? null);
  const answer = useConfirmStore((s) => s.answer);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (req) okRef.current?.focus();
  }, [req]);

  if (!req) return null;
  return (
    <Modal open onClose={() => answer(req.id, false)} widthClass="max-w-sm" testId="confirm-dialog">
      <div
        className="px-5 pb-4 pt-5"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            answer(req.id, true);
          }
        }}
      >
        <div className="text-[15px] font-semibold leading-snug text-[color:var(--text-primary)]">{req.title}</div>
        {req.message && (
          <div className="mt-2 text-[13px] leading-relaxed text-[color:var(--text-secondary)]">{req.message}</div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => answer(req.id, false)}>
            {req.cancelLabel ?? "取消"}
          </Button>
          <Button
            ref={okRef}
            variant={req.danger ? "dangerSolid" : "primary"}
            onClick={() => answer(req.id, true)}
          >
            {req.confirmLabel ?? "确定"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
