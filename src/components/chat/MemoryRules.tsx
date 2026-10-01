import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { api, type AiMemory, type RuleMode, type WritingRule } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { openMenuAt } from "../../stores/menu";
import { toast } from "../../stores/toast";
import { errMsg } from "../../lib/errors";
import { usePhraseBias } from "../../lib/ai/phraseBias";

// 记忆与规则（阶段 2B，NovelAI Memory / Author's Note + Cursor rules 移植）：
// - 常驻记忆：本书（全书基调、世界观要点）+ 本卷（章在卷里时），每轮放进 system
// - 作者注：本章的近端强约束（「这段要虐」），放在写作指令之前
// - 写作规则：全书常驻 / 只在指定章或卷生效 / 手动（输入框「规则」里本轮选用）
// 文本框失焦即存；空文本 = 删除。

const MODE_LABEL: Record<RuleMode, string> = { always: "全书常驻", scoped: "指定章卷", manual: "手动选用" };

function MemoryField({ label, hint, value, onSave, testId }: { label: string; hint: string; value: string; onSave: (v: string) => void; testId: string }) {
  const [v, setV] = useState(value);
  const saved = useRef(value);
  useEffect(() => {
    setV(value);
    saved.current = value;
  }, [value]);
  return (
    <label className="block text-xs">
      <span className="text-[color:var(--text-primary)]">{label}</span>
      <span className="ml-2 text-2xs text-[color:var(--text-faint)]">{hint}</span>
      <textarea
        value={v}
        data-testid={testId}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v !== saved.current) {
            saved.current = v;
            onSave(v);
          }
        }}
        rows={3}
        className="mt-1 w-full resize-y rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] px-2 py-1.5 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
      />
    </label>
  );
}

function RuleRow({ rule, onChanged }: { rule: WritingRule; onChanged: () => void }) {
  const chapters = useWorkspace((s) => s.chapters);
  const volumes = useWorkspace((s) => s.volumes);
  const [title, setTitle] = useState(rule.title);
  const [content, setContent] = useState(rule.content);
  const save = async (patch: Partial<WritingRule>) => {
    try {
      await api.ruleUpsert({ id: rule.id, book_id: rule.book_id, title, content, mode: rule.mode, scope_ids: rule.scope_ids, ...patch });
      onChanged();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const nameOf = (id: number) => volumes.find((v) => v.id === id)?.title ?? chapters.find((c) => c.id === id)?.title ?? `#${id}`;
  const toggleScope = (id: number) => {
    const ids = rule.scope_ids.includes(id) ? rule.scope_ids.filter((x) => x !== id) : [...rule.scope_ids, id];
    void save({ scope_ids: ids });
  };
  return (
    <div className="rounded-[var(--r-control)] border border-[color:var(--hairline)] p-2" data-rule-row={rule.id}>
      <div className="flex items-center gap-1.5">
        <input
          value={title}
          aria-label="规则标题"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== rule.title && void save({ title })}
          className="min-w-0 flex-1 bg-transparent text-xs font-medium text-[color:var(--text-primary)] outline-none"
        />
        <button
          onClick={(e) =>
            openMenuAt(
              e.currentTarget,
              (Object.keys(MODE_LABEL) as RuleMode[]).map((m) => ({ label: MODE_LABEL[m], checked: rule.mode === m, onSelect: () => void save({ mode: m }) })),
              "end",
            )
          }
          className="shrink-0 rounded px-1.5 py-0.5 text-2xs text-[color:var(--accent)] hover:bg-[var(--fill-hover)]"
        >
          {MODE_LABEL[rule.mode]}
        </button>
        <button
          aria-label={`删除规则「${rule.title}」`}
          onClick={async () => {
            await api.ruleDelete(rule.id);
            onChanged();
          }}
          className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--danger)]"
        >
          <Trash2 size={12} />
        </button>
      </div>
      <textarea
        value={content}
        aria-label="规则内容"
        placeholder="规则内容，如：对话用「」，不用 “”；动作描写少用副词"
        onChange={(e) => setContent(e.target.value)}
        onBlur={() => content !== rule.content && void save({ content })}
        rows={2}
        className="mt-1 w-full resize-y bg-transparent text-xs leading-relaxed text-[color:var(--text-secondary)] outline-none placeholder:text-[color:var(--text-faint)]"
      />
      {rule.mode === "scoped" && (
        <div className="mt-1 flex flex-wrap items-center gap-1 text-2xs">
          {rule.scope_ids.map((id) => (
            <button key={id} onClick={() => toggleScope(id)} className="rounded-full bg-[var(--fill-element)] px-1.5 py-0.5 text-[color:var(--text-secondary)] hover:line-through">
              {nameOf(id)}
            </button>
          ))}
          <button
            onClick={(e) =>
              openMenuAt(e.currentTarget, [
                ...volumes.map((v) => ({ label: `卷：${v.title}`, checked: rule.scope_ids.includes(v.id), onSelect: () => toggleScope(v.id) })),
                ...(volumes.length > 0 ? [{ type: "separator" as const }] : []),
                ...chapters.map((c) => ({ label: c.title, checked: rule.scope_ids.includes(c.id), onSelect: () => toggleScope(c.id) })),
              ])
            }
            className="rounded-full px-1.5 py-0.5 text-[color:var(--accent)] hover:bg-[var(--fill-hover)]"
          >
            + 选择章 / 卷
          </button>
        </div>
      )}
    </div>
  );
}

// 词语偏置（阶段 2C）：AI 腔禁用 / 偏好用词。生成时告诉 AI；回答里出现禁用表达会提醒并可「去掉重写」。
function PhraseBiasSection({ bookId, onChanged }: { bookId: number; onChanged: () => void }) {
  const list = usePhraseBias((s) => s.list);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"ban" | "prefer">("ban");
  const [global, setGlobal] = useState(false);
  const reload = async () => {
    await usePhraseBias.getState().load(bookId);
    onChanged();
  };
  const add = async () => {
    const words = text.split(/[、,，;；\n]/).map((t) => t.trim()).filter(Boolean);
    if (words.length === 0) return;
    try {
      for (const w of words) await api.phraseBiasAdd(global ? null : bookId, w, kind);
      setText("");
      await reload();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const chips = (k: "ban" | "prefer") =>
    list
      .filter((p) => p.kind === k)
      .map((p) => (
        <span key={p.id} data-phrase={p.phrase} className="flex items-center gap-1 rounded-full bg-[var(--fill-element)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--text-secondary)]">
          {p.book_id == null && <span className="text-[color:var(--text-faint)]">通用</span>}
          {p.phrase}
          <button
            aria-label={`删除「${p.phrase}」`}
            onClick={async () => {
              await api.phraseBiasDelete(p.id);
              await reload();
            }}
            className="rounded-full p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--danger)]"
          >
            <Trash2 size={10} />
          </button>
        </span>
      ));
  const bans = chips("ban");
  const prefers = chips("prefer");
  return (
    <div data-testid="phrase-bias">
      <div className="mb-1 flex items-center text-xs">
        <span className="text-[color:var(--text-primary)]">词语偏置</span>
        <span className="ml-2 text-2xs text-[color:var(--text-faint)]">AI 腔禁用 / 偏好用词，生成时告诉 AI</span>
        <span className="flex-1" />
        <button
          onClick={async () => {
            try {
              const n = await api.phraseBiasImportDefaults(null);
              toast.success(n > 0 ? `已导入 ${n} 条常见 AI 腔（所有书通用，可逐条删）` : "常见 AI 腔都已在表里");
              await reload();
            } catch (e) {
              toast.error(errMsg(e));
            }
          }}
          className="rounded px-1.5 py-0.5 text-2xs text-[color:var(--accent)] hover:bg-[var(--fill-hover)]"
        >
          导入常见 AI 腔
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          value={text}
          aria-label="添加词语"
          placeholder="如：嘴角勾起一抹弧度（多个用、分隔）"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void add();
            }
          }}
          className="min-w-0 flex-1 rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
        />
        <select aria-label="词语类别" value={kind} onChange={(e) => setKind(e.target.value as "ban" | "prefer")} className="rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] px-1 py-1 text-2xs">
          <option value="ban">禁用</option>
          <option value="prefer">偏好</option>
        </select>
        <label className="flex items-center gap-1 text-2xs text-[color:var(--text-secondary)]">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          所有书通用
        </label>
        <button onClick={() => void add()} className="rounded px-1.5 py-0.5 text-2xs text-[color:var(--accent)] hover:bg-[var(--fill-hover)]">
          添加
        </button>
      </div>
      <div className="mt-1.5 space-y-1 text-2xs">
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[color:var(--text-faint)]">禁用</span>
          {bans.length > 0 ? bans : <span className="text-[color:var(--text-faint)]">（空）</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[color:var(--text-faint)]">偏好</span>
          {prefers.length > 0 ? prefers : <span className="text-[color:var(--text-faint)]">（空）</span>}
        </div>
      </div>
    </div>
  );
}

export function MemoryRules({ onChanged }: { onChanged?: () => void }) {
  const bookId = useWorkspace((s) => s.currentBookId);
  const chapterId = useWorkspace((s) => s.currentChapterId);
  const [mem, setMem] = useState<AiMemory | null>(null);
  const [rules, setRules] = useState<WritingRule[]>([]);
  const reload = async () => {
    if (bookId == null) return;
    try {
      setMem(await api.aiMemoryGet(bookId, chapterId));
      setRules(await api.rulesList(bookId));
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapterId]);
  const saveMem = async (scope: "book" | "volume" | "chapter", id: number, text: string) => {
    try {
      await api.aiMemorySet(scope, id, text);
      onChanged?.();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  if (bookId == null || mem == null) return <div className="p-4 text-xs text-[color:var(--text-faint)]">加载中…</div>;
  const changed = () => {
    void reload();
    onChanged?.();
  };
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="memory-rules">
      <MemoryField label="本书常驻记忆" hint="每轮都带：基调、世界观要点、不能违背的设定" value={mem.book} onSave={(v) => void saveMem("book", bookId, v)} testId="memory-book" />
      {mem.volume_id != null && (
        <MemoryField label={`本卷记忆 ·「${mem.volume_title}」`} hint="本卷各章都带" value={mem.volume} onSave={(v) => void saveMem("volume", mem.volume_id!, v)} testId="memory-volume" />
      )}
      {chapterId != null && (
        <MemoryField label="本章作者注" hint="近端强约束，放在指令之前，如「这段要虐」" value={mem.chapter_note} onSave={(v) => void saveMem("chapter", chapterId, v)} testId="memory-chapter" />
      )}
      <div>
        <div className="mb-1 flex items-center text-xs">
          <span className="text-[color:var(--text-primary)]">写作规则</span>
          <span className="ml-2 text-2xs text-[color:var(--text-faint)]">全书常驻 / 指定章卷 / 手动选用</span>
          <span className="flex-1" />
          <button
            onClick={async () => {
              try {
                await api.ruleUpsert({ id: null, book_id: bookId, title: "新规则", content: "", mode: "always", scope_ids: [] });
                changed();
              } catch (e) {
                toast.error(errMsg(e));
              }
            }}
            className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-2xs text-[color:var(--accent)] hover:bg-[var(--fill-hover)]"
          >
            <Plus size={11} />
            新建规则
          </button>
        </div>
        <div className="space-y-1.5">
          {rules.length === 0 && <div className="text-2xs text-[color:var(--text-faint)]">还没有规则。例：「对话用「」」「第一人称」「不写血腥细节」</div>}
          {rules.map((r) => (
            <RuleRow key={`${r.id}:${r.mode}:${r.scope_ids.join(",")}`} rule={r} onChanged={changed} />
          ))}
        </div>
      </div>
      <PhraseBiasSection bookId={bookId} onChanged={() => onChanged?.()} />
    </div>
  );
}
