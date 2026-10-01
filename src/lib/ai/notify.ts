import { getCurrentWindow, UserAttentionType } from "@tauri-apps/api/window";

// 长任务完成通知（阶段 2C）：一轮生成 ≥ 10 秒、结束时窗口不在前台 → 任务栏闪动提示，
// 标题前加「✓」，回到窗口即复原。不弹系统通知（不打扰正在别处读资料的作者）。
export const LONG_TASK_MS = 10_000;

export function notifyIfAway(startedAt: number | null, label: string): boolean {
  if (startedAt == null || Date.now() - startedAt < LONG_TASK_MS) return false;
  if (typeof document === "undefined" || document.hasFocus()) return false;
  try {
    void getCurrentWindow()
      .requestUserAttention(UserAttentionType.Informational)
      .catch(() => {});
  } catch {
    // 非 Tauri 环境
  }
  const orig = document.title.replace(/^✓ [^·]+ · /, "");
  document.title = `✓ ${label} · ${orig}`;
  const back = () => {
    document.title = orig;
    window.removeEventListener("focus", back);
  };
  window.addEventListener("focus", back);
  return true;
}
