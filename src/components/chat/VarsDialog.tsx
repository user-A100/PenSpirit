import { useEffect, useState } from "react";
import { useVarsDialog } from "../../stores/varsDialog";
import { Modal } from "../ui/Modal";
import { Button } from "../ui/Button";

// 上次填过的值：再跑同一命令时预填（只在内存里）
const last = new Map<string, string>();

export function VarsDialog() {
  const req = useVarsDialog((s) => s.req);
  const answer = useVarsDialog((s) => s.answer);
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (req) setValues(Object.fromEntries(req.names.map((n) => [n, last.get(n) ?? ""])));
  }, [req]);
  if (!req) return null;
  const submit = () => {
    for (const [k, v] of Object.entries(values)) last.set(k, v);
    answer(values);
  };
  return (
    <Modal open onClose={() => answer(null)} title={`/${req.title}`} testId="vars-dialog">
      <form
        className="space-y-2 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {req.names.map((n, i) => (
          <label key={n} className="block text-xs">
            <span className="text-[color:var(--text-secondary)]">{n}</span>
            <input
              autoFocus={i === 0}
              value={values[n] ?? ""}
              aria-label={n}
              onChange={(e) => setValues({ ...values, [n]: e.target.value })}
              onKeyDown={(e) => {
                // 显式处理回车（不依赖表单隐式提交；输入法组字中的回车不算）
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
              className="mt-1 w-full rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] px-2 py-1.5 text-ui text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
            />
          </label>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" onClick={() => answer(null)}>
            取消
          </Button>
          <Button variant="primary" type="submit">
            运行
          </Button>
        </div>
      </form>
    </Modal>
  );
}
