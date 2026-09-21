import { useEffect, useState } from "react";
import { Bot, Check, ChevronDown, ChevronRight, Copy, Loader2, Plus, RotateCcw, Star, Trash2 } from "lucide-react";
import { AgentDescriptor } from "../../lib/tauri";
import { useAgents } from "../../stores/agents";

// 与 Rust registry::builtin_templates 对齐（列表删光后可一键恢复）
const BUILTIN_AGENTS: AgentDescriptor[] = [
  { id: "claude", name: "Claude Code", command: "claude-agent-acp", args: [], enabled: true, is_default: true, last_probe: null },
  { id: "codex", name: "Codex", command: "codex-acp", args: [], enabled: true, is_default: false, last_probe: null },
  { id: "gemini", name: "Gemini", command: "gemini", args: ["--acp", "--skip-trust"], enabled: true, is_default: false, last_probe: null },
];

// 探测失败时的安装指引（手动安装，不做自动安装器）
const INSTALL_HINTS: Record<string, string> = {
  claude: "npm i -g @agentclientprotocol/claude-agent-acp",
  codex: "npm i -g @agentclientprotocol/codex-acp",
  gemini: "npm i -g @google/gemini-cli",
};

function SectionTitle(props: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs text-[color:var(--text-faint)]">{props.children}</div>;
}

function StatusDot(props: { probe: AgentDescriptor["last_probe"] }) {
  const color = props.probe?.ok ? "var(--success)" : props.probe ? "var(--danger)" : "var(--text-faint)";
  const title = props.probe?.ok
    ? `已连接：${props.probe.agent_name ?? "?"}${props.probe.protocol_version ? `（${props.probe.protocol_version}）` : ""}`
    : props.probe
      ? `探测失败：${props.probe.detail ?? "未知原因"}`
      : "未探测";
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} title={title} />;
}

// 紧凑开关：启用 / 停用
function EnableToggle(props: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={props.onToggle}
      title={props.on ? "停用（保留配置）" : "启用"}
      className={`relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150 ${props.on ? "bg-[var(--accent)]" : "bg-[var(--border-strong)]"}`}
    >
      <span
        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all duration-150 ${props.on ? "left-3.5" : "left-0.5"}`}
      />
    </button>
  );
}

/** 安装指引块：内置 agent 探测失败时给出 npm 安装命令 + 复制按钮。 */
function InstallHint(props: { agentId: string }) {
  const cmd = INSTALL_HINTS[props.agentId];
  const [copied, setCopied] = useState(false);
  if (!cmd) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 剪贴板不可用时保持展示，用户可手动选择
    }
  };
  return (
    <div className="mt-1.5 flex items-center gap-1.5 rounded border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-2 py-1">
      <span className="shrink-0 text-[10px] text-[color:var(--text-faint)]">未检测到命令，可安装：</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-[color:var(--text-secondary)]">{cmd}</code>
      <button
        onClick={() => void copy()}
        title="复制安装命令"
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        {copied ? <Check size={11} className="text-[color:var(--success)]" /> : <Copy size={11} />}
        {copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

/** 添加自定义 agent 的折叠表单。 */
function AddCustomForm(props: { onAdd: (desc: AgentDescriptor) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
      >
        <Plus size={14} />
        添加自定义 agent
      </button>
    );
  }

  const submit = async () => {
    if (busy) return;
    if (!name.trim() || !command.trim()) {
      setErr("名称与命令不能为空");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await props.onAdd({
        id: `custom:${Date.now().toString(36)}`,
        name: name.trim(),
        command: command.trim(),
        args: args.trim() ? args.trim().split(/\s+/) : [],
        enabled: true,
        is_default: false,
        last_probe: null,
      });
      setOpen(false);
      setName("");
      setCommand("");
      setArgs("");
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-[color:var(--border-subtle)] p-2.5">
      <div className="flex items-center gap-1 text-xs font-medium text-[color:var(--text-primary)]">
        <Bot size={13} />
        自定义 agent
        <span className="flex-1" />
        <button
          onClick={() => setOpen(false)}
          title="收起"
          className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <ChevronDown size={13} />
        </button>
      </div>
      <input className={inputCls} placeholder="名称，如：My Agent" value={name} onChange={(e) => setName(e.target.value)} />
      <input className={`${inputCls} font-mono`} placeholder="命令，如：my-agent-acp" value={command} onChange={(e) => setCommand(e.target.value)} />
      <input className={`${inputCls} font-mono`} placeholder="参数（空格分隔），如：--acp --verbose" value={args} onChange={(e) => setArgs(e.target.value)} />
      {err && <div className="text-xs text-[color:var(--danger)]">{err}</div>}
      <button
        onClick={() => void submit()}
        disabled={busy}
        className="self-start rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        添加
      </button>
    </div>
  );
}

/**
 * Agent 设置面板：本机 ACP agent 管理（探测/启用/默认/删除/自定义）
 * + 内置项安装指引。探测走 Rust 短连接（15s 超时），结果回写 agents.json。
 */
export function AgentsPane() {
  const { agents, probing, error, load, probe, setDefault, upsert, remove } = useAgents();

  useEffect(() => {
    void load();
  }, [load]);

  const handleRemove = async (a: AgentDescriptor) => {
    if (!window.confirm(`确定删除 agent「${a.name}」？`)) return;
    await remove(a.id);
  };

  const restoreBuiltins = async () => {
    // 已存在的 id 会被 upsert 覆盖回内置配置
    for (const desc of BUILTIN_AGENTS) await upsert(desc);
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionTitle>本机 Agent（ACP 直连，免 API Key）</SectionTitle>

      {error && (
        <div className="rounded-md border border-[color:var(--danger)] px-2.5 py-1.5 text-xs text-[color:var(--danger)]">{error}</div>
      )}

      {agents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-md border border-[color:var(--border-subtle)] px-2.5 py-4">
          <div className="text-xs text-[color:var(--text-faint)]">列表已空，可恢复内置模板或添加自定义 agent</div>
          <button
            onClick={() => void restoreBuiltins()}
            className="flex items-center gap-1.5 rounded-md border border-[color:var(--border-strong)] px-3 py-1.5 text-sm text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <RotateCcw size={13} />
            恢复内置
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {agents.map((a) => (
            <div key={a.id} className="rounded-[var(--radius-md)] border border-[color:var(--border-subtle)] px-3 py-2.5 transition-colors duration-[var(--dur-md)] hover:border-[color:var(--accent)]">
              <div className="flex items-center gap-2">
                <StatusDot probe={a.last_probe} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className={`truncate text-sm ${a.enabled ? "text-[color:var(--text-primary)]" : "text-[color:var(--text-faint)]"}`}>{a.name}</span>
                    {a.is_default && (
                      <span className="shrink-0 rounded-full bg-[var(--accent-dim)] px-2 py-0.5 text-xs text-[color:var(--accent)]">默认</span>
                    )}
                  </div>
                  <div className="truncate font-mono text-[11px] text-[color:var(--text-faint)]">
                    {a.command}
                    {a.args.length > 0 ? ` ${a.args.join(" ")}` : ""}
                  </div>
                </div>
                {!a.is_default && (
                  <button
                    onClick={() => void setDefault(a.id)}
                    title="设为默认（agent 后端按默认位发车）"
                    className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                  >
                    <Star size={12} />
                    设为默认
                  </button>
                )}
                <button
                  onClick={() => void probe(a.id)}
                  disabled={probing.has(a.id)}
                  title="短连接探测（spawn → initialize → 退出）"
                  className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {probing.has(a.id) ? <Loader2 size={12} className="animate-spin" /> : <ChevronRight size={12} />}
                  {probing.has(a.id) ? "探测中" : "探测"}
                </button>
                <button
                  onClick={() => void handleRemove(a)}
                  title="删除该 agent"
                  className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                >
                  <Trash2 size={13} />
                </button>
                <EnableToggle on={a.enabled} onToggle={() => void upsert({ ...a, enabled: !a.enabled })} />
              </div>

              {/* 探测结果行内展示 */}
              {a.last_probe && (
                <div className={`mt-1 text-[11px] ${a.last_probe.ok ? "text-[color:var(--success)]" : "text-[color:var(--danger)]"}`}>
                  {a.last_probe.ok
                    ? `已连接 ${a.last_probe.agent_name ?? a.name}${a.last_probe.protocol_version ? ` · 协议 ${a.last_probe.protocol_version}` : ""}${a.last_probe.can_resume ? " · 支持恢复会话" : ""}`
                    : `探测失败：${a.last_probe.detail ?? "未知原因"}`}
                </div>
              )}
              {a.last_probe && !a.last_probe.ok && <InstallHint agentId={a.id} />}
            </div>
          ))}
        </div>
      )}

      <AddCustomForm onAdd={upsert} />

      <p className="text-xs leading-relaxed text-[color:var(--text-faint)]">
        agent 经 ACP 协议本机直连（无需 API Key）；「默认」项即 AI Dock 选择 agent 后端时的发车目标。
        探测需对应命令已安装且在 PATH 中（重启笔仙可使新装命令生效）。
      </p>
    </div>
  );
}
