// 统一错误文案：Tauri 命令抛出的 AppError 序列化为 {code, message}
// （src-tauri/src/error.rs：serde tag="code" content="message"），
// 直接 errMsg(e) 会得到 "[object Object]"。所有 UI 错误路径一律走 errMsg。

export interface AppErrorShape {
  code: string;
  message?: string;
}

function isAppError(e: unknown): e is AppErrorShape {
  return typeof e === "object" && e !== null && typeof (e as { code?: unknown }).code === "string";
}

// invalid 的 message 本身就是给用户看的中文句子，不加前缀
const CODE_LABEL: Record<string, string> = {
  db: "数据库错误",
  io: "文件错误",
  not_found: "未找到",
  invalid: "",
  lock_poisoned: "数据库锁中毒，请重启应用",
};

/** 任意异常 → 可读文案（永不返回 "[object Object]"） */
export function errMsg(e: unknown): string {
  if (e == null) return "未知错误";
  if (typeof e === "string") return e;
  if (isAppError(e)) {
    const label = CODE_LABEL[e.code] ?? e.code;
    const msg = typeof e.message === "string" ? e.message : "";
    if (!msg) return label || "未知错误";
    return label ? `${label}：${msg}` : msg;
  }
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string" && m) return m;
    try {
      return JSON.stringify(e);
    } catch {
      return "未知错误";
    }
  }
  return String(e);
}

/** 结构化错误码（非 AppError 返回 null），供 UI 分支判断 */
export function errCode(e: unknown): string | null {
  return isAppError(e) ? e.code : null;
}
