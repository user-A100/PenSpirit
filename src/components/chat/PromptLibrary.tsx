import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { api, type ProviderProfile, type RatingStat } from "../../lib/tauri";
import { AUTO_VARS, blankPrompt, templateVars, usePrompts, type PromptTemplate } from "../../lib/ai/prompts";
import { SLASH_COMMANDS, type CommandOutput } from "../../lib/ai/slashCommands";
import { confirmDialog } from "../../stores/confirm";
import { toast } from "../../stores/toast";
import { errMsg } from "../../lib/errors";

// 命令库（阶段 2B）：管理自定义命令。全书通用；输入框打 / 使用，标了「进气泡」的也出现在正文选区气泡里。

const OUTPUT_LABEL: Record<CommandOutput, string> = { insert: "插入光标处", replace: "替换选区", chat: "仅对话" };
const LENGTHS: Array<[number | null, string]> = [[null, "跟随输入区"], [300, "约 300 字"], [800, "约 800 字"], [1500, "约 1500 字"], [3000, "约 3000 字"]];

const chip =
  "rounded-[4px] px-1.5 py-0.5 text-2xs transition-colors border border-[color:var(--hairline)] hover:bg-[var(--fill-hover)]";
const field =
  "mt-1 w-full rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]";

function Seg<T extends string | boolean>({ value, options, onChange, label }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="mt-1 inline-flex rounded-[var(--r-control)] bg-[var(--fill-element)] p-0.5">
      {options.map(([v, l]) => (
        <button
          key={String(v)}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={`rounded-[4px] px-2 py-0.5 text-2xs transition-colors ${value === v ? "bg-[var(--fill-selected)] text-[color:var(--text-primary)] [box-shadow:var(--shadow-chip)]" : "text-[color:var(--text-faint)] hover:text-[color:var(--text-secondary)]"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Editor({ initial, providers, onDone }: { initial: PromptTemplate; providers: ProviderProfile[]; onDone: () => void }) {
  const [t, setT] = useState(initial);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const { save, remove, list } = usePrompts.getState();
  const isNew = !list.some((x) => x.id === t.id);
  const set = (patch: Partial<PromptTemplate>) => setT({ ...t, ...patch });
  const insertVar = (name: string) => {
    const ta = taRef.current;
    const token = `{{${name}}}`;
    const at = ta?.selectionStart ?? t.template.length;
    set({ template: t.template.slice(0, at) + token + t.template.slice(ta?.selectionEnd ?? at) });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(at + token.length, at + token.length);
    });
  };
  const asked = templateVars(t.template).filter((v) => !AUTO_VARS.includes(v));
  const submit = async () => {
    const name = t.name.trim();
    if (!name || !t.template.trim()) return toast.error("名字和模板都要填");
    if (/\s/.test(name)) return toast.error("名字里不能有空格（输入框里用 /名字 叫它）");
    if (SLASH_COMMANDS.some((c) => c.name === name)) return toast.error(`「${name}」和内置命令重名了`);
    if (list.some((x) => x.id !== t.id && x.name === name)) return toast.error(`已经有叫「${name}」的命令了`);
    try {
      await save({ ...t, name });
      toast.success(isNew ? `已添加 /${name}` : `已保存 /${name}`);
      onDone();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  return (
    <form
      data-testid="prompt-editor"
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex gap-2">
        <label className="block w-32 shrink-0 text-xs">
          <span className="text-[color:var(--text-secondary)]">名字</span>
          <input value={t.name} aria-label="命令名" placeholder="如：加强冲突" onChange={(e) => set({ name: e.target.value })} className={field} />
        </label>
        <label className="block min-w-0 flex-1 text-xs">
          <span className="text-[color:var(--text-secondary)]">说明</span>
          <input value={t.desc} aria-label="命令说明" placeholder="斜杠菜单里显示的一句话" onChange={(e) => set({ desc: e.target.value })} className={field} />
        </label>
      </div>
      <label className="block text-xs">
        <span className="text-[color:var(--text-secondary)]">模板</span>
        <textarea
          ref={taRef}
          rows={5}
          value={t.template}
          aria-label="命令模板"
          placeholder={"如：把{{选区}}改得冲突更尖锐，让{{人物}}主动挑衅，不改结局。"}
          onChange={(e) => set({ template: e.target.value })}
          className={`${field} resize-y leading-relaxed`}
        />
      </label>
      <div className="flex flex-wrap items-center gap-1 text-2xs text-[color:var(--text-faint)]">
        <span>自动填：</span>
        {AUTO_VARS.map((v) => (
          <button key={v} type="button" onClick={() => insertVar(v)} className={chip}>
            {`{{${v}}}`}
          </button>
        ))}
        <span className="ml-1">其它 {"{{名字}}"} 运行时询问{asked.length > 0 && `（本命令会问：${asked.join("、")}）`}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
        <div>
          <div className="text-[color:var(--text-secondary)]">模式</div>
          <Seg label="模式" value={t.mode} options={[["write", "写正文"], ["discuss", "讨论"]]} onChange={(v) => set({ mode: v, output: v === "discuss" ? "chat" : t.output === "chat" ? "insert" : t.output })} />
        </div>
        <div>
          <div className="text-[color:var(--text-secondary)]">产出</div>
          <Seg label="产出" value={t.output} options={(Object.keys(OUTPUT_LABEL) as CommandOutput[]).map((k) => [k, OUTPUT_LABEL[k]])} onChange={(v) => set({ output: v })} />
        </div>
      </div>
      <div className="flex flex-wrap gap-2 text-xs">
        <label className="block w-28">
          <span className="text-[color:var(--text-secondary)]">温度</span>
          <input
            type="number"
            step={0.1}
            min={0}
            max={2}
            aria-label="温度"
            placeholder="跟随"
            value={t.temperature ?? ""}
            onChange={(e) => set({ temperature: e.target.value === "" ? null : Math.max(0, Math.min(2, Number(e.target.value))) })}
            className={field}
          />
        </label>
        <label className="block w-32">
          <span className="text-[color:var(--text-secondary)]">长度</span>
          <select aria-label="长度" value={t.targetChars ?? ""} onChange={(e) => set({ targetChars: e.target.value === "" ? null : Number(e.target.value) })} className={field}>
            {LENGTHS.map(([v, l]) => (
              <option key={l} value={v ?? ""}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0 flex-1">
          <span className="text-[color:var(--text-secondary)]">模型</span>
          <select aria-label="绑定模型" value={t.providerId ?? ""} onChange={(e) => set({ providerId: e.target.value === "" ? null : Number(e.target.value) })} className={field}>
            <option value="">跟随「使用中」</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-[color:var(--text-secondary)]">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={t.sendNow} onChange={(e) => set({ sendNow: e.target.checked })} />
          选中即发（不先放进输入框）
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={t.inBubble} onChange={(e) => set({ inBubble: e.target.checked })} />
          出现在正文选区气泡
        </label>
      </div>
      <div className="flex items-center gap-2 pt-1">
        {!isNew && (
          <button
            type="button"
            onClick={async () => {
              if (!(await confirmDialog({ title: `删除 /${t.name}？`, confirmLabel: "删除", danger: true }))) return;
              await remove(t.id);
              onDone();
            }}
            className="flex items-center gap-1 rounded-[var(--r-control)] px-2 py-1 text-xs text-[color:var(--danger)] hover:bg-[var(--fill-hover)]"
          >
            <Trash2 size={12} /> 删除
          </button>
        )}
        <span className="flex-1" />
        <button type="button" onClick={onDone} className="rounded-[var(--r-control)] px-3 py-1.5 text-xs text-[color:var(--text-secondary)] hover:bg-[var(--fill-hover)]">
          取消
        </button>
        <button type="submit" className="rounded-[var(--r-control)] bg-[var(--accent-solid)] px-3 py-1.5 text-xs font-medium text-white">
          {isNew ? "添加" : "保存"}
        </button>
      </div>
    </form>
  );
}

export function PromptLibrary({ onClose }: { onClose: () => void }) {
  const list = usePrompts((s) => s.list);
  const [editing, setEditing] = useState<PromptTemplate | null>(null);
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [stats, setStats] = useState<RatingStat[]>([]);
  useEffect(() => {
    if (!usePrompts.getState().loaded) void usePrompts.getState().load();
    api.listProviders().then(setProviders, () => setProviders([]));
    // 阶段 2C：每个命令的 👍 / 👎（回答上的评分，本地提示词调优用）
    api.ratingStats().then(setStats, () => setStats([]));
  }, []);
  const statOf = (id: string) => stats.find((s) => s.command === `custom:${id}`);
  const providerName = (id: number | null) => providers.find((p) => p.id === id)?.name;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="prompt-library">
      <div className="mb-2 flex items-center gap-2">
        <button aria-label="返回对话" onClick={onClose} className="rounded-[var(--r-control)] p-1 text-[color:var(--text-faint)] hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]">
          <ArrowLeft size={14} />
        </button>
        <span className="text-xs font-medium text-[color:var(--text-primary)]">命令库</span>
        <span className="text-2xs text-[color:var(--text-faint)]">全书通用 · 输入框打 / 使用</span>
        <span className="flex-1" />
        {!editing && (
          <button onClick={() => setEditing(blankPrompt())} className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs text-[color:var(--accent)] hover:bg-[var(--fill-hover)]">
            <Plus size={11} /> 新建命令
          </button>
        )}
      </div>
      {editing ? (
        <Editor key={editing.id} initial={editing} providers={providers} onDone={() => setEditing(null)} />
      ) : list.length === 0 ? (
        <div className="space-y-1 text-xs text-[color:var(--text-faint)]">
          <p>还没有自定义命令。把常用的提示词存成命令，以后打 / 一下就能用。</p>
          <p>例：/加强冲突 —— 「把{"{{选区}}"}改得冲突更尖锐，不改结局」，产出「替换选区」，进选区气泡。</p>
        </div>
      ) : (
        <ul className="space-y-1">
          {list.map((p) => (
            <li key={p.id}>
              <button
                data-prompt-row={p.id}
                onClick={() => setEditing(p)}
                className="block w-full rounded-[var(--r-control)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--fill-hover)]"
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium text-[color:var(--text-primary)]">/{p.name}</span>
                  <span className="min-w-0 flex-1 truncate text-[color:var(--text-faint)]">{p.desc}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-2xs text-[color:var(--text-faint)]">
                  <span>{p.mode === "write" ? "写正文" : "讨论"}</span>
                  <span>· {OUTPUT_LABEL[p.output]}</span>
                  {p.temperature != null && <span>· 温度 {p.temperature}</span>}
                  {p.providerId != null && <span>· {providerName(p.providerId) ?? "已删除的模型（回落到使用中）"}</span>}
                  {p.inBubble && <span>· 进气泡</span>}
                  {p.sendNow && <span>· 选中即发</span>}
                  {statOf(p.id) && (
                    <span data-prompt-rating="">
                      · 👍 {statOf(p.id)!.up} · 👎 {statOf(p.id)!.down}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
