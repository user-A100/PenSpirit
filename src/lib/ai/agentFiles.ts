import { api, type FileChange } from "../tauri";
import { editorsShowing } from "../editorBridge";
import { useWorkspace } from "../../stores/workspace";
import { toast } from "../../stores/toast";

// agent 改了书里的文件之后（回合结束 / 撤销 / 恢复）：刷新目录；打开着的章重读磁盘。
// 编辑器里有没落盘的改动时不覆盖（以用户为准），把 AI 的版本存进版本历史免得丢。
export async function syncAfterAgentChanges(changes: FileChange[]): Promise<void> {
  const ws = useWorkspace.getState();
  const bookId = ws.currentBookId;
  if (bookId == null || changes.length === 0) return;
  const slug = ws.books.find((b) => b.id === bookId)?.slug;
  if (!slug) return;
  await ws.reloadChapters();
  const after = useWorkspace.getState();
  const touched = new Set(changes.filter((c) => c.kind !== "deleted").map((c) => `${slug}/${c.path}`));
  const ids = after.chapters.filter((c) => touched.has(c.file_path)).map((c) => c.id);
  for (const ed of editorsShowing(ids)) {
    try {
      const fresh = (await api.readChapter(ed.chapterId)).content;
      if (ed.isDirty?.()) {
        await api.snapshotNow(ed.chapterId, fresh).catch(() => {});
        const title = after.chapters.find((c) => c.id === ed.chapterId)?.title ?? "";
        toast.info(`「${title}」在 AI 改动期间你也改过：保留编辑器里的版本，AI 的版本已存进版本历史`);
      } else {
        ed.resetContent?.(fresh);
      }
    } catch (e) {
      console.warn("agent 改动后刷新编辑器失败:", e);
    }
  }
  // 当前章被移进了回收站（撤销了 AI 新建的章）→ 换到第一章
  if (after.currentChapterId != null && !after.chapters.some((c) => c.id === after.currentChapterId)) {
    const next = after.chapters[0]?.id;
    if (next != null) await after.selectChapter(next);
  }
}
