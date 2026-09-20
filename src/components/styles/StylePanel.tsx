import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Check, Eye, Plus, Trash2, Upload } from "lucide-react";
import { StyleCard } from "../../lib/tauri";
import { parseTags, toTagsJson, useStyles } from "../../stores/styles";
import { useWorkspace } from "../../stores/workspace";
import { Modal } from "../ui/Modal";

interface FormState {
  id: number; name: string; prompt_md: string; sample_md: string; tagsText: string;
}

const EMPTY: FormState = { id: 0, name: "", prompt_md: "", sample_md: "", tagsText: "" };

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";
const TEXTAREA = `${INPUT} resize-y text-xs leading-relaxed`;

export function StylePanel() {
  const { styles, activeStyleId, editingId, error, load, save, remove, activate, setEditing } = useStyles();
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StyleCard | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // 挂载与换书时刷新（激活位按书记录）
  useEffect(() => { void load(); }, [load, currentBookId]);

  // 编辑目标变化时同步表单；保存后 load 刷新列表也走这条路径
  useEffect(() => {
    const s = styles.find((x) => x.id === editingId);
    setForm(
      s
        ? { id: s.id, name: s.name, prompt_md: s.prompt_md, sample_md: s.sample_md, tagsText: parseTags(s.tags).join(", ") }
        : EMPTY,
    );
  }, [editingId, styles]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  const editing = form.id !== 0;

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await save(form.id, form.name.trim(), form.prompt_md, form.sample_md, toTagsJson(form.tagsText));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!editing || !window.confirm(`确定删除文风「${form.name}」？`)) return;
    setBusy(true);
    try {
      await remove(form.id);
    } finally {
      setBusy(false);
    }
  };

  // 导入文风 skill 的 markdown：全文进「风格指令」，文件名去扩展名进名称（仅当名称尚空）
  const handleImport = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // 允许重复选同一文件
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const base = file.name.replace(/\.[^.]+$/, "");
      setForm((prev) => ({ ...prev, prompt_md: text, name: prev.name.trim() ? prev.name : base }));
    };
    reader.readAsText(file);
  };

  const sample = form.sample_md.trim();

  return (
    <div className="flex h-full flex-col">
      {/* 当前书激活位：下拉含「无文风」(0) */}
      <div className="shrink-0 border-b border-[color:var(--border-subtle)] p-2.5">
        <div className="mb-1 flex items-center justify-between text-xs text-[color:var(--text-secondary)]">
          <span>本书激活文风</span>
          {activeStyleId === 0 && <span className="text-[color:var(--text-faint)]">未启用</span>}
        </div>
        <select
          value={activeStyleId}
          disabled={currentBookId == null}
          title={currentBookId == null ? "先在左侧选择一本书" : "续写时把该文风注入 system 槽"}
          onChange={(e) => void activate(Number(e.target.value))}
          className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <option value={0}>无文风</option>
          {styles.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        {error && (
          <div className="mb-2 rounded-md border border-[color:var(--danger)] px-2.5 py-1.5 text-xs text-[color:var(--danger)]">
            {error}
          </div>
        )}

        {/* 列表：名称 + 标签 chips + 激活标记，点击编辑 */}
        <div className="mb-1.5 flex items-center justify-between text-xs text-[color:var(--text-faint)]">
          <span>文风库（{styles.length}）</span>
          <button
            onClick={() => { setEditing(null); setForm(EMPTY); }}
            className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <Plus size={12} /> 新建
          </button>
        </div>

        {styles.length === 0 ? (
          <div className="mb-3 rounded-md border border-[color:var(--border-subtle)] px-2.5 py-3 text-center text-xs leading-relaxed text-[color:var(--text-faint)]">
            还没有文风卡
            <br />
            新建，或用「导入 md」引入文风 skill
          </div>
        ) : (
          <div className="mb-3 flex flex-col gap-1.5">
            {styles.map((s) => {
              const tags = parseTags(s.tags);
              return (
                <button
                  key={s.id}
                  onClick={() => setEditing(s.id)}
                  className={`flex w-full flex-col rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 ${
                    s.id === activeStyleId
                      ? "border-[color:var(--accent)]"
                      : s.id === editingId
                        ? "border-[color:var(--border-strong)]"
                        : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="truncate text-sm text-[color:var(--text-primary)]">{s.name}</span>
                    {s.id === activeStyleId && (
                      <Check size={12} className="shrink-0 text-[color:var(--accent)]" aria-label="当前激活" />
                    )}
                  </span>
                  {tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {tags.map((t) => (
                        <span key={t} className="rounded-full bg-[var(--bg-hover)] px-1.5 py-0.5 text-xs text-[color:var(--text-faint)]">
                          {t}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* 编辑表单 */}
        <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">
          {editing ? `编辑「${form.name}」` : "新建文风"}
        </div>
        <div className="flex flex-col gap-2">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="名称，如：冷峻仙侠"
            className={INPUT}
          />
          <textarea
            rows={4}
            value={form.prompt_md}
            onChange={(e) => setForm({ ...form, prompt_md: e.target.value })}
            placeholder="风格指令（续写时注入 system 槽）"
            className={TEXTAREA}
          />
          <div>
            <textarea
              rows={3}
              value={form.sample_md}
              onChange={(e) => setForm({ ...form, sample_md: e.target.value })}
              placeholder="样章（仅用于预览，不注入）"
              className={TEXTAREA}
            />
            <div className="mt-1 flex justify-end">
              <button
                onClick={() => setPreview({
                  id: form.id, name: form.name, prompt_md: form.prompt_md, sample_md: form.sample_md,
                  tags: toTagsJson(form.tagsText), created_at: "", updated_at: "",
                })}
                disabled={!sample}
                title={sample ? "查看该文风写出来的样子" : "该文风暂无样章，请先在样章框填写"}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Eye size={12} /> 预览样章
              </button>
            </div>
          </div>
          <input
            value={form.tagsText}
            onChange={(e) => setForm({ ...form, tagsText: e.target.value })}
            placeholder="标签，逗号分隔，如：仙侠, 冷峻"
            className={INPUT}
          />
        </div>
      </div>

      {/* 底部操作 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[color:var(--border-subtle)] p-2.5">
        <button
          onClick={handleSave}
          disabled={busy || !form.name.trim()}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          保存
        </button>
        <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown" onChange={handleImport} className="hidden" />
        <button
          onClick={() => fileRef.current?.click()}
          title="导入文风 skill 的 markdown：正文进「风格指令」"
          className="flex items-center gap-1.5 rounded-md border border-[color:var(--border-strong)] px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <Upload size={13} /> 导入 md
        </button>
        <span className="flex-1" />
        {editing && (
          <button
            onClick={handleRemove}
            disabled={busy}
            title="删除该文风"
            className="rounded-md p-1.5 text-[color:var(--danger)] transition-colors duration-150 hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
          </button>
        )}
      </div>

      {/* 样章预览模态 */}
      {preview && (
        <Modal
          open
          onClose={() => setPreview(null)}
          title={`样章预览 · ${preview.name}`}
          widthClass="max-w-lg"
          maxHeightClass="max-h-[80vh]"
          testId="style-preview-backdrop"
        >
            <div className="flex-1 overflow-y-auto whitespace-pre-wrap p-4 text-sm leading-relaxed text-[color:var(--text-secondary)]">
              {preview.sample_md}
            </div>
        </Modal>
      )}
    </div>
  );
}
