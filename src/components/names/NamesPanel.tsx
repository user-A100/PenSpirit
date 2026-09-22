import { useState } from "react";
import { Copy, Dices } from "lucide-react";
import { api, type GeneratedName, type NameRequest } from "../../lib/tauri";

// 取名（M7 批次7，Scrivener 名字生成器的中文化替身）：
// 约束控制面（性别/开头/含有/生僻度/数量）→ Rust 语料生成，
// 每次点生成换 seed，同名不重复。结果一键复制供写作时取用。

const GENDER_LABEL = { any: "不限", male: "男", female: "女" } as const;
const OBSCURITY_LABEL = { any: "不限", common: "常见", rare: "生僻" } as const;

// 注意：此处不带 w-full——真实 CSS 里 w-full 会压过同元素上的 w-14（生成顺序靠后），
// 把旁边 flex-1 的生成按钮挤出面板（实机核验踩过）。
const INPUT =
  "rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

export function NamesPanel() {
  const [gender, setGender] = useState<NameRequest["gender"]>("any");
  const [obscurity, setObscurity] = useState<NameRequest["obscurity"]>("any");
  const [startsWith, setStartsWith] = useState("");
  const [contains, setContains] = useState("");
  const [count, setCount] = useState(10);
  const [names, setNames] = useState<GeneratedName[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const generate = async () => {
    const result = await api.namesGenerate({
      gender,
      starts_with: startsWith.trim().slice(0, 1),
      contains: contains.trim().slice(0, 1),
      obscurity,
      count,
      seed: Date.now(),
    });
    setNames(result);
  };

  const copy = async (n: GeneratedName) => {
    await navigator.clipboard.writeText(n.full);
    setCopied(n.full);
    setTimeout(() => setCopied((c) => (c === n.full ? null : c)), 1200);
  };

  return (
    <div className="flex h-full flex-col p-3 text-xs" data-testid="names-panel">
      <div className="mb-2 shrink-0 space-y-1.5">
        <div className="flex items-center gap-1.5">
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value as NameRequest["gender"])}
            aria-label="性别"
            className={`${INPUT} w-0 min-w-0 flex-1`}
          >
            {(Object.keys(GENDER_LABEL) as (keyof typeof GENDER_LABEL)[]).map((g) => (
              <option key={g} value={g}>{GENDER_LABEL[g]}</option>
            ))}
          </select>
          <select
            value={obscurity}
            onChange={(e) => setObscurity(e.target.value as NameRequest["obscurity"])}
            aria-label="生僻度"
            className={`${INPUT} w-0 min-w-0 flex-1`}
          >
            {(Object.keys(OBSCURITY_LABEL) as (keyof typeof OBSCURITY_LABEL)[]).map((o) => (
              <option key={o} value={o}>{OBSCURITY_LABEL[o]}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            value={startsWith}
            onChange={(e) => setStartsWith(e.target.value)}
            placeholder="开头一字（可空）"
            maxLength={1}
            className={`${INPUT} min-w-0 flex-1`}
          />
          <input
            value={contains}
            onChange={(e) => setContains(e.target.value)}
            placeholder="含有一字（可空）"
            maxLength={1}
            className={`${INPUT} min-w-0 flex-1`}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            min={1}
            max={50}
            value={count}
            onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
            aria-label="数量"
            data-testid="names-count"
            className={`${INPUT} w-14 shrink-0`}
          />
          <button
            onClick={() => void generate()}
            data-testid="names-generate"
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
          >
            <Dices size={13} />
            生成
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {names == null ? (
          <div className="text-[color:var(--text-faint)]">设定约束后生成一批名字，点名字即复制。</div>
        ) : names.length === 0 ? (
          <div className="text-[color:var(--text-faint)]">约束太紧没凑够，放宽一点再试。</div>
        ) : (
          names.map((n, i) => (
            <button
              key={`${n.full}-${i}`}
              onClick={() => void copy(n)}
              data-testid="names-result"
              title="复制"
              className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left transition-colors duration-150 hover:border-[color:var(--accent)] hover:bg-[var(--bg-hover)]"
            >
              <span className="text-sm text-[color:var(--text-primary)]">{n.full}</span>
              <span className="text-[10px] text-[color:var(--text-faint)]">
                {GENDER_LABEL[n.gender]}
                {n.rare && " · 生僻"}
              </span>
              <span className="ml-auto shrink-0 text-[10px] text-[color:var(--text-faint)]">
                {copied === n.full ? "已复制" : <Copy size={11} />}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
