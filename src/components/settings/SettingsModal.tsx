import { useEffect, useState } from "react";
import { Check, Plus } from "lucide-react";
import { useSettings } from "../../stores/settings";
import { ProviderProfile } from "../../lib/tauri";
import { AgentsPane } from "./AgentsPane";
import { AppearancePane } from "./AppearancePane";
import { ImportPane } from "./ImportPane";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal } from "../ui/Modal";

const EMPTY: ProviderProfile = {
  id: 0, name: "", base_url: "", api_key: "", model: "", max_tokens: 4096, temperature: 0.7,
};

// 顶部 tab：Agent（ACP 直连，免配置推荐路径）+ 外观 + 导入 + AI 服务商（高级）
const TABS = [
  { id: "agent", label: "Agent" },
  { id: "appearance", label: "外观" },
  { id: "import", label: "导入" },
  { id: "provider", label: "AI 服务商" },
] as const;
type SettingsTab = (typeof TABS)[number]["id"];

interface FormErrors { name?: string; base_url?: string; model?: string }

// 校验：name/model/base_url 非空，base_url 以 http 开头
function validate(p: ProviderProfile): FormErrors {
  const errs: FormErrors = {};
  if (!p.name.trim()) errs.name = "名称不能为空";
  if (!p.model.trim()) errs.model = "模型不能为空";
  const url = p.base_url.trim();
  if (!url) errs.base_url = "地址不能为空";
  else if (!url.startsWith("http")) errs.base_url = "地址需以 http 开头";
  return errs;
}

// 输入项：bg-elevated 圆角，focus 时 border-accent；带校验错误时 border-danger
function Field(props: {
  label: string;
  value: string;
  type?: string;
  placeholder?: string;
  step?: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[color:var(--text-secondary)]">{props.label}</span>
      <Input
        type={props.type ?? "text"}
        value={props.value}
        step={props.step}
        placeholder={props.placeholder}
        invalid={!!props.error}
        onChange={(e) => props.onChange(e.target.value)}
      />
      {props.error && <span className="mt-1 block text-xs text-[color:var(--danger)]">{props.error}</span>}
    </label>
  );
}

export function SettingsModal() {
  const { providers, activeProviderId, modalOpen, error, load, save, remove, activate, close } = useSettings();
  const [tab, setTab] = useState<SettingsTab>("agent");
  const [form, setForm] = useState<ProviderProfile>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [busy, setBusy] = useState(false);

  // 打开时刷新列表并回到首个 tab + 「新增」表单（Esc 关闭由 Modal 承担）
  useEffect(() => {
    if (!modalOpen) return;
    setTab("agent");
    setForm(EMPTY);
    setErrors({});
    load();
  }, [modalOpen, load]);

  if (!modalOpen) return null;

  const editing = form.id !== 0;

  const handleSave = async () => {
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    try {
      const payload: ProviderProfile = {
        ...form,
        name: form.name.trim(),
        base_url: form.base_url.trim(),
        model: form.model.trim(),
        max_tokens: Math.max(1, Math.round(Number(form.max_tokens) || 4096)),
        temperature: Math.min(2, Math.max(0, Number(form.temperature) || 0)),
      };
      const saved = await save(payload);
      setForm(saved); // 保存后停留在该条目的编辑态（含后端分配的 id）
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!editing || !window.confirm(`确定删除服务商「${form.name}」？`)) return;
    setBusy(true);
    try {
      await remove(form.id);
      setForm(EMPTY);
      setErrors({});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={modalOpen} onClose={close} title="设置" testId="settings-backdrop">
      {/* 顶部 tab */}
      <div className="flex shrink-0 gap-1 border-b border-[color:var(--border-subtle)] px-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors duration-[var(--dur-md)] ${
              tab === t.id
                ? "border-[color:var(--accent)] text-[color:var(--text-primary)]"
                : "border-transparent text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "agent" && <AgentsPane />}
          {tab === "appearance" && <AppearancePane />}
          {tab === "import" && <ImportPane />}
          {tab === "provider" && (
            <>
          {/* 服务商列表：点击编辑，激活项 accent 边 + 「使用中」徽章 */}
          <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">服务商</div>
          <div className="mb-3 flex flex-col gap-1.5">
            {providers.length === 0 && (
              <div className="rounded-md border border-[color:var(--border-subtle)] px-2.5 py-3 text-center text-xs text-[color:var(--text-faint)]">
                尚未配置服务商，请在下方填写并保存
              </div>
            )}
            {providers.map((p) => {
              const isActive = activeProviderId === p.id;
              const isEditing = form.id === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => { setForm(p); setErrors({}); }}
                  className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors duration-150 ${
                    isActive
                      ? "border-[color:var(--accent)]"
                      : isEditing
                        ? "border-[color:var(--border-strong)]"
                        : "border-[color:var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-[color:var(--text-primary)]">{p.name}</span>
                    <span className="block truncate text-xs text-[color:var(--text-faint)]">{p.model}</span>
                  </span>
                  {isActive && (
                    <span className="shrink-0 rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs text-[color:var(--accent)]">
                      使用中
                    </span>
                  )}
                </button>
              );
            })}
            <button
              onClick={() => { setForm(EMPTY); setErrors({}); }}
              className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <Plus size={14} />
              新增服务商
            </button>
          </div>

          {/* 编辑表单：六字段 */}
          <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">
            {editing ? `编辑「${form.name}」` : "新增服务商"}
          </div>
          {error && (
            <div className="mb-2 rounded-md border border-[color:var(--danger)] px-2.5 py-1.5 text-xs text-[color:var(--danger)]">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="名称" value={form.name} placeholder="如：DeepSeek" error={errors.name} onChange={(v) => setForm({ ...form, name: v })} />
              <Field label="模型" value={form.model} placeholder="如：deepseek-chat" error={errors.model} onChange={(v) => setForm({ ...form, model: v })} />
            </div>
            <Field label="API 地址" value={form.base_url} placeholder="https://api.example.com/v1" error={errors.base_url} onChange={(v) => setForm({ ...form, base_url: v })} />
            <Field label="API Key" type="password" value={form.api_key} placeholder="sk-…" onChange={(v) => setForm({ ...form, api_key: v })} />
            <div className="grid grid-cols-2 gap-2.5">
              <Field label="最大 Token" type="number" step="1" value={String(form.max_tokens)} onChange={(v) => setForm({ ...form, max_tokens: Number(v) || 0 })} />
              <Field label="温度" type="number" step="0.1" value={String(form.temperature)} onChange={(v) => setForm({ ...form, temperature: Number(v) || 0 })} />
            </div>
          </div>
            </>
          )}
        </div>

        {/* 底部操作：仅服务商 tab（外观 tab 实时生效，无保存按钮） */}
        {tab === "provider" && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[color:var(--border-subtle)] p-3">
          <Button variant="primary" onClick={handleSave} disabled={busy}>
            保存
          </Button>
          {editing && (
            <Button
              onClick={() => activate(form.id)}
              disabled={busy || activeProviderId === form.id}
              title={activeProviderId === form.id ? "当前已是使用中的服务商" : "将 AI 写作切换到该服务商"}
            >
              <Check size={14} />
              {activeProviderId === form.id ? "使用中" : "设为使用中"}
            </Button>
          )}
          <span className="flex-1" />
          {editing && (
            <Button variant="danger" onClick={handleRemove} disabled={busy}>
              删除
            </Button>
          )}
        </div>
        )}
    </Modal>
  );
}
