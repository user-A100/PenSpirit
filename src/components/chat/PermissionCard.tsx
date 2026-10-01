import { ShieldAlert } from "lucide-react";
import { useChat } from "../../stores/chat";
import { TOOL_KIND_LABEL } from "./AgentTools";

/**
 * ACP 权限弹卡：agent 请求工具授权时插在消息流顶部（一次一张，其余排队）。
 * 选项按钮按 kind 着色——allow_* 绿 / reject_* 红；点击即应答并收卡
 * （超时兜底在 Rust 侧自动拒绝）。阶段 2B：「本会话一直允许此类操作」——
 * 同一会话里同类别的后续请求自动放行（只在内存里，会话菜单可清除）。
 */
export function PermissionCard() {
  const permission = useChat((s) => s.permission);
  const queued = useChat((s) => s.permissionQueue.length);
  const respond = useChat((s) => s.respondPermission);
  if (!permission) return null;
  const kindLabel = TOOL_KIND_LABEL[permission.tool_kind ?? "other"] ?? "其他";
  const allow = permission.options.find((o) => o.kind === "allow_once") ?? permission.options.find((o) => o.kind.startsWith("allow"));

  return (
    <div className="mb-2.5 rounded-md border border-[color:var(--warning)] bg-[var(--bg-elevated)] px-2.5 py-2" data-permission-card="">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--warning)]">
        <ShieldAlert size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 break-all">{permission.title}</span>
        <span className="shrink-0 rounded-[4px] bg-[var(--fill-element)] px-1.5 py-px text-2xs font-normal text-[color:var(--text-secondary)]">{kindLabel}</span>
        {queued > 0 && <span className="shrink-0 text-2xs font-normal text-[color:var(--text-faint)]">还有 {queued} 个</span>}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {permission.options.map((o) => (
          <button
            key={o.option_id}
            onClick={() => void respond(o.option_id)}
            className={`rounded border px-2 py-0.5 text-xs transition-colors duration-150 hover:bg-[var(--bg-hover)] ${
              o.kind.startsWith("allow")
                ? "border-[color:var(--success)] text-[color:var(--success)]"
                : "border-[color:var(--danger)] text-[color:var(--danger)]"
            }`}
          >
            {o.name}
          </button>
        ))}
        {allow && (
          <button
            onClick={() => void respond(allow.option_id, { always: true })}
            data-tip="同一会话里这一类操作以后都直接允许（关掉应用或在会话菜单清除即失效）"
            className="rounded border border-dashed border-[color:var(--success)] px-2 py-0.5 text-xs text-[color:var(--success)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
          >
            本会话一直允许「{kindLabel}」
          </button>
        )}
      </div>
    </div>
  );
}
