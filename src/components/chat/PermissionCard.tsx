import { ShieldAlert } from "lucide-react";
import { useChat } from "../../stores/chat";

/**
 * ACP 权限弹卡：agent 请求工具授权时插在消息流顶部（一次一张）。
 * 选项按钮按 kind 着色——allow_* 绿 / reject_* 红；点击即应答并收卡
 * （超时兜底在 Rust 侧自动拒绝）。
 */
export function PermissionCard() {
  const permission = useChat((s) => s.permission);
  const respond = useChat((s) => s.respondPermission);
  if (!permission) return null;

  return (
    <div className="mb-2.5 rounded-md border border-[color:var(--warning)] bg-[var(--bg-elevated)] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--warning)]">
        <ShieldAlert size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 break-all">{permission.title}</span>
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
      </div>
    </div>
  );
}
