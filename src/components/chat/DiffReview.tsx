import { useEffect, useMemo, useState } from "react";
import { diffChars } from "diff";
import { Check, Undo2 } from "lucide-react";
import { useReview } from "../../stores/review";
import { applyHunks, paragraphHunks, splitParas, type Segment } from "../../lib/ai/paraDiff";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

/** 一处改动：删除线 = 去掉的原文，底色 = 新增内容 */
export function CharDiff({ before, after }: { before: string; after: string }) {
  const parts = useMemo(() => diffChars(before, after), [before, after]);
  return (
    <>
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
    </>
  );
}

// 替换选区前的差异预览（阶段 2B：逐段取舍）。原文与新文按段对齐成若干「改动块」，
// 每块可单独「采用」或「保留原文」；应用 = 按取舍拼出的文本。Enter 应用 / Esc 取消。
export function DiffReview() {
  const req = useReview((s) => s.req);
  const answer = useReview((s) => s.answer);
  const segs = useMemo<Segment[]>(() => (req ? paragraphHunks(req.before, req.after) : []), [req]);
  const total = segs.filter((s) => s.kind === "change").length;
  const [accepted, setAccepted] = useState<boolean[]>([]);
  useEffect(() => setAccepted(new Array(total).fill(true)), [segs, total]);
  // 新请求的第一帧 accepted 还没重置：缺省一律视为采用
  const isOn = (k: number) => accepted[k] ?? true;
  const picked = Array.from({ length: total }, (_, k) => isOn(k)).filter(Boolean).length;

  const apply = () => {
    if (!req) return;
    if (picked === 0) return answer(null);
    // 一块都没拒：原样用新文（保留 AI 的分段与空白）；否则按块拼
    answer(picked === total ? req.after : applyHunks(segs, isOn));
  };

  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.isComposing && !e.shiftKey) {
        e.preventDefault();
        apply();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!req) return null;
  const removed = diffChars(req.before, req.after).reduce((n, p) => n + (p.removed ? p.value.length : 0), 0);
  const added = diffChars(req.before, req.after).reduce((n, p) => n + (p.added ? p.value.length : 0), 0);
  let k = -1;
  return (
    <Modal open onClose={() => answer(null)} title={req.title} widthClass="max-w-3xl" testId="diff-review">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-[color:var(--text-faint)]">
          <span>
            删除 <span className="text-[color:var(--danger)]">{removed}</span> 字
          </span>
          <span>
            新增 <span className="text-[color:var(--success)]">{added}</span> 字
          </span>
          <span>
            原文 {req.before.length} → 新文 {req.after.length} 字
          </span>
          {total > 1 && (
            <span className="ml-auto flex gap-1">
              <button onClick={() => setAccepted(new Array(total).fill(true))} className="rounded-[4px] px-1.5 py-0.5 hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]">
                全部采用
              </button>
              <button onClick={() => setAccepted(new Array(total).fill(false))} className="rounded-[4px] px-1.5 py-0.5 hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]">
                全部保留原文
              </button>
            </span>
          )}
        </div>
        <div className="prose-serif space-y-2 leading-loose">
          {segs.map((s, i) => {
            if (s.kind === "same")
              return (
                <p key={i} className="whitespace-pre-wrap px-4 text-[color:var(--text-secondary)] opacity-70">
                  {s.text}
                </p>
              );
            const idx = ++k;
            const on = isOn(idx);
            const oldText = s.old.join("\n");
            return (
              <div
                key={i}
                data-hunk={idx}
                data-accepted={on ? "1" : "0"}
                className={`group/hunk relative rounded-[var(--r-control)] px-4 py-2 transition-colors ${
                  on ? "bg-[var(--fill-element)]" : "bg-transparent [box-shadow:inset_0_0_0_1px_var(--hairline)]"
                }`}
              >
                {total > 1 && (
                  <button
                    onClick={() => setAccepted(Array.from({ length: total }, (_, j) => (j === idx ? !on : isOn(j))))}
                    aria-label={on ? "这处保留原文" : "这处采用新文"}
                    className={`absolute right-1.5 top-1.5 flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 font-sans text-2xs transition-colors ${
                      on
                        ? "text-[color:var(--success)] hover:bg-[var(--fill-hover)]"
                        : "text-[color:var(--text-faint)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
                    }`}
                  >
                    {on ? <Check size={11} /> : <Undo2 size={11} />}
                    {on ? "采用" : "保留原文"}
                  </button>
                )}
                <div className="whitespace-pre-wrap pr-16">
                  {on ? <CharDiff before={oldText} after={s.new.join("\n")} /> : oldText || <span className="text-[color:var(--text-faint)]">（不加这段）</span>}
                </div>
              </div>
            );
          })}
          {segs.length === 0 && splitParas(req.after).length === 0 && <p className="text-xs text-[color:var(--text-faint)]">新文为空</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2 px-5 pb-4">
        <Button variant="ghost" onClick={() => answer(null)}>
          取消
        </Button>
        <Button variant="primary" disabled={total > 0 && picked === 0} onClick={apply}>
          {total > 1 ? `应用 ${picked}/${total} 处` : "接受替换"}
        </Button>
      </div>
    </Modal>
  );
}
