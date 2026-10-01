import { api } from "../tauri";
import { editorsShowing, getActiveEditor, type EditorBridge } from "../editorBridge";
import { toast } from "../../stores/toast";
import { errMsg } from "../errors";

// 采纳检查点（阶段 2B，Cursor checkpoint）：每次把 AI 文字写进正文前，先把当前全文强制存一版快照
// （版本历史里能找回），并按消息记下采纳前的原文；之后随时可「恢复到采纳之前」。
// 恢复本身也先快照当前版本，且走编辑器事务（Ctrl+Z 可撤回），所以两个方向都不丢字。

export interface Checkpoint {
  chapterId: number;
  content: string;
  at: number;
}

const byMessage = new Map<number, Checkpoint>();

/** 采纳前调用：存快照（失败不阻断采纳）并返回检查点 */
export async function takeCheckpoint(ed: EditorBridge): Promise<Checkpoint | null> {
  const content = ed.markdown?.();
  if (content == null) return null;
  try {
    await api.snapshotNow(ed.chapterId, content);
  } catch (e) {
    console.warn("采纳前快照失败:", e);
  }
  return { chapterId: ed.chapterId, content, at: Date.now() };
}

export function rememberCheckpoint(messageId: number, cp: Checkpoint | null): void {
  if (cp) byMessage.set(messageId, cp);
}

export function checkpointFor(messageId: number): Checkpoint | undefined {
  return byMessage.get(messageId);
}

export function forgetCheckpoint(messageId: number): void {
  byMessage.delete(messageId);
}

/** 恢复到某条回答采纳之前。章在编辑器里开着 → 走编辑器（可撤销、自动保存）；没开 → 直接写盘。 */
export async function restoreCheckpoint(messageId: number): Promise<boolean> {
  const cp = byMessage.get(messageId);
  if (!cp) return false;
  try {
    const active = getActiveEditor();
    const ed = active?.chapterId === cp.chapterId ? active : editorsShowing([cp.chapterId])[0];
    if (ed?.restoreContent && ed.markdown) {
      await api.snapshotNow(cp.chapterId, ed.markdown());
      ed.restoreContent(cp.content);
    } else {
      const cur = await api.readChapter(cp.chapterId);
      await api.snapshotNow(cp.chapterId, cur.content);
      await api.writeChapter(cp.chapterId, cp.content);
    }
    byMessage.delete(messageId);
    return true;
  } catch (e) {
    toast.error(`恢复失败：${errMsg(e)}`);
    return false;
  }
}
