import { useEffect, useMemo } from "react";
import { diffChars } from "diff";
import { useReview } from "../../stores/review";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

// 替换选区前的差异预览：删除线 = 去掉的原文，底色 = 新增内容；Enter 接受 / Esc 取消。
export function DiffReview() {
  const req = useReview((s) => s.req);
  const answer = useReview((s) => s.answer);
  const parts = useMemo(() => (req ? diffChars(req.before, req.after) : []), [req]);

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.isComposing && !e.shiftKey) {
        e.preventDefault();
        answer(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [req, answer]);

  if (!req) return null;
  const removed = parts.filter((p) => p.removed).reduce((n, p) => n + p.value.length, 0);
  const added = parts.filter((p) => p.added).reduce((n, p) => n + p.value.length, 0);
  return (
    <Modal open onClose={() => answer(false)} title={req.title} widthClass="max-w-3xl" testId="diff-review">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex gap-3 text-xs text-[color:var(--text-faint)]">
          <span>
            删除 <span className="text-[color:var(--danger)]">{removed}</span> 字
          </span>
          <span>
            新增 <span className="text-[color:var(--success)]">{added}</span> 字
          </span>
          <span>原文 {req.before.length} → 新文 {req.after.length} 字</span>
        </div>
        <div className="prose-serif whitespace-pre-wrap rounded-[var(--r-control)] bg-[var(--fill-element)] px-4 py-3 leading-loose">
          {parts.map((p, i) =>
            p.added ? (
              <ins key={i} className="rounded-[2px] bg-[color-mix(in_srgb,var(--success)_22%,transparent)] no-underline">
                {p.value}
              </ins>
            ) : p.removed ? (
              <del key={i} className="text-[color:var(--danger)] decoration-[color:var(--danger)] opacity-70">
                {p.value}
              </del>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )}
        </div>
      </div>
      <div className="flex shrink-0 justify-end gap-2 px-5 pb-4">
        <Button variant="ghost" onClick={() => answer(false)}>
          取消
        </Button>
        <Button variant="primary" onClick={() => answer(true)}>
          接受替换
        </Button>
      </div>
    </Modal>
  );
}
