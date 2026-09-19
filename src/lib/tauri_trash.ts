import { invoke } from "@tauri-apps/api/core";
import type { Book, ChapterMeta } from "./tauri";

// M2-T6 回收站命令封装。独立于 lib/tauri.ts（该文件由并行任务 M2-T5 修改中）。
// 软删条目在基础类型上扩展 deleted_at 与原位置字段。

export interface TrashedChapter extends ChapterMeta {
  deleted_at: string | null;
  orig_file_path: string | null;
}

export interface TrashedBook extends Book {
  deleted_at: string | null;
  orig_dir_name: string | null;
}

export const trashApi = {
  listTrash: (bookId: number) => invoke<TrashedChapter[]>("list_trash", { bookId }),
  restoreChapter: (id: number) => invoke<void>("restore_chapter", { id }),
  purgeChapter: (id: number) => invoke<void>("purge_chapter", { id }),
  emptyTrash: (bookId: number) => invoke<void>("empty_trash", { bookId }),
  listTrashBooks: () => invoke<TrashedBook[]>("list_trash_books"),
  restoreBook: (id: number) => invoke<void>("restore_book", { id }),
  purgeBook: (id: number) => invoke<void>("purge_book", { id }),
};
