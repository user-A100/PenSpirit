import { invoke } from "@tauri-apps/api/core";

export interface Book { id: number; slug: string; title: string; created_at: string; updated_at: string }
export interface ChapterMeta { id: number; book_id: number; file_path: string; title: string; sort_key: number; word_count: number; created_at: string; updated_at: string }
export interface ChapterContent { meta: ChapterMeta; content: string }

// ---- M1：字段名与 Rust 结构体 snake_case 对齐 ----
export interface ProviderProfile { id: number; name: string; base_url: string; api_key: string; model: string; max_tokens: number; temperature: number }
export interface StyleCard { id: number; name: string; prompt_md: string; sample_md: string; tags: string; created_at: string; updated_at: string } // tags 为 JSON 数组字符串
export interface ChatSession { id: number; book_id: number; chapter_id: number; title: string; created_at: string }
export interface ChatMessage { id: number; session_id: number; role: string; content: string; created_at: string }
export interface SlotLog { name: string; source: string; chars: number; est_tokens: number; preview_head: string }
export interface AssemblyLog { slots: SlotLog[]; total_est_tokens: number }

export const api = {
  listBooks: () => invoke<Book[]>("list_books"),
  createBook: (title: string) => invoke<Book>("create_book", { title }),
  deleteBook: (id: number) => invoke<void>("delete_book", { id }),
  listChapters: (bookId: number) => invoke<ChapterMeta[]>("list_chapters", { bookId }),
  createChapter: (bookId: number, title: string) => invoke<ChapterMeta>("create_chapter", { bookId, title }),
  renameChapter: (id: number, newTitle: string) => invoke<ChapterMeta>("rename_chapter", { id, newTitle }),
  deleteChapter: (id: number) => invoke<void>("delete_chapter", { id }),
  readChapter: (id: number) => invoke<ChapterContent>("read_chapter", { id }),
  writeChapter: (id: number, content: string) => invoke<ChapterMeta>("write_chapter", { id, content }),
  rescanLibrary: () => invoke<number>("rescan_library"),
  // ---- M1：命令参数 JS camelCase，结构体字段保持 snake_case ----
  listProviders: () => invoke<ProviderProfile[]>("list_providers"),
  saveProvider: (p: ProviderProfile) => invoke<ProviderProfile>("save_provider", { p }),
  deleteProvider: (id: number) => invoke<void>("delete_provider", { id }),
  setActiveProvider: (id: number) => invoke<void>("set_active_provider", { id }),
  getActiveProvider: () => invoke<number | null>("get_active_provider"),
  listStyles: () => invoke<StyleCard[]>("list_styles"),
  saveStyle: (id: number, name: string, promptMd: string, sampleMd: string, tags: string) =>
    invoke<StyleCard>("save_style", { id, name, promptMd, sampleMd, tags }),
  deleteStyle: (id: number) => invoke<void>("delete_style", { id }),
  setActiveStyle: (bookId: number, styleId: number) => invoke<void>("set_active_style", { bookId, styleId }),
  // 当前书的激活文风位；null / 0 均为「无文风」
  getActiveStyle: (bookId: number) => invoke<number | null>("get_active_style", { bookId }),
  listSessions: (chapterId: number) => invoke<ChatSession[]>("list_sessions", { chapterId }),
  getOrCreateSession: (chapterId: number) => invoke<ChatSession>("get_or_create_session", { chapterId }),
  listMessages: (sessionId: number) => invoke<ChatMessage[]>("list_messages", { sessionId }),
  deleteMessage: (id: number) => invoke<void>("delete_message", { id }),
  sendMessage: (sessionId: number, instruction: string) =>
    invoke<ChatMessage>("send_message", { sessionId, instruction }),
  cancelGeneration: (sessionId: number) => invoke<void>("cancel_generation", { sessionId }),
  previewContext: (sessionId: number, instruction: string) =>
    invoke<AssemblyLog>("preview_context", { sessionId, instruction }),
};
