import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { api } from "../../lib/tauri";
import { toast } from "../../stores/toast";
import { errMsg } from "../../lib/errors";

// 设定卡「对 AI 隐藏」开关（阶段 2B，防剧透）：隐藏后注入时跳过；@ 主动引用仍可带上。
// 另附人物卡「仅作者可见」笔记（真实身份等，永不发给 AI）。

export function SecretNote({ id, initial }: { id: number; initial: string }) {
  const [v, setV] = useState(initial);
  const [saved, setSaved] = useState(initial);
  return (
    <label className="mt-2 block text-2xs text-[color:var(--text-faint)]" onClick={(e) => e.stopPropagation()}>
      仅作者可见（真实身份等，永不发给 AI）
      <textarea
        value={v}
        aria-label="仅作者可见的笔记"
        rows={2}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if (v === saved) return;
          try {
            await api.characterSetSecret(id, v);
            setSaved(v);
          } catch (err) {
            toast.error(errMsg(err));
          }
        }}
        className="mt-0.5 w-full resize-y rounded border border-dashed border-[color:var(--hairline)] bg-transparent px-1.5 py-1 text-xs text-[color:var(--text-secondary)] outline-none focus:border-[color:var(--accent)]"
      />
    </label>
  );
}
export function AiHiddenToggle({
  kind,
  id,
  hidden,
  onChange,
}: {
  kind: "character" | "foreshadow" | "plot" | "outline";
  id: number;
  hidden: boolean;
  onChange?: (hidden: boolean) => void;
}) {
  const [v, setV] = useState(hidden);
  return (
    <button
      aria-pressed={v}
      aria-label={v ? "已对 AI 隐藏（点击恢复）" : "对 AI 隐藏"}
      data-tip={v ? "已对 AI 隐藏：自动注入时跳过（防剧透）" : "对 AI 隐藏（防剧透）"}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await api.cardSetAiHidden(kind, id, !v);
          setV(!v);
          onChange?.(!v);
        } catch (err) {
          toast.error(errMsg(err));
        }
      }}
      className={`shrink-0 rounded p-0.5 transition-colors hover:bg-[var(--fill-hover)] ${v ? "text-[color:var(--accent)]" : "text-[color:var(--text-faint)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100"}`}
    >
      {v ? <EyeOff size={12} /> : <Eye size={12} />}
    </button>
  );
}
