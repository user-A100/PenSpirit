import { save, type SaveDialogOptions } from "@tauri-apps/plugin-dialog";

// 保存对话框的统一入口。实机核验钩子（只在开发构建里存在，生产构建整段剔除）：
// 原生保存对话框 CDP 点不到，核验脚本预置 window.__e2eSavePath，下一次保存直接用它（用后即删，并计数）。
export async function pickSavePath(opts: SaveDialogOptions): Promise<string | null> {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __e2eSavePath?: string; __e2eSaveCalls?: number };
    if (w.__e2eSavePath) {
      const p = w.__e2eSavePath;
      delete w.__e2eSavePath;
      w.__e2eSaveCalls = (w.__e2eSaveCalls ?? 0) + 1;
      return p;
    }
  }
  return save(opts);
}
