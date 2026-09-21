import { invoke } from "@tauri-apps/api/core";

export interface Book { id: number; slug: string; title: string; created_at: string; updated_at: string; target_words: number | null }
export interface ChapterMeta { id: number; book_id: number; file_path: string; title: string; sort_key: number; word_count: number; created_at: string; updated_at: string }
export interface ChapterContent { meta: ChapterMeta; content: string }

// ---- M1：字段名与 Rust 结构体 snake_case 对齐 ----
export interface ProviderProfile { id: number; name: string; base_url: string; api_key: string; model: string; max_tokens: number; temperature: number }
export interface StyleCard { id: number; name: string; prompt_md: string; sample_md: string; tags: string; created_at: string; updated_at: string } // tags 为 JSON 数组字符串
export interface ChatSession { id: number; book_id: number; chapter_id: number; title: string; created_at: string }
export interface ChatMessage { id: number; session_id: number; role: string; content: string; created_at: string }
export interface SlotLog { name: string; source: string; chars: number; est_tokens: number; preview_head: string }
export interface AssemblyLog { slots: SlotLog[]; total_est_tokens: number }

// ---- M2：ACP agent（字段 snake_case 与 Rust models.rs 对齐） ----
export interface ProbeResult {
  ok: boolean; agent_name: string | null; protocol_version: string | null; can_resume: boolean; detail: string | null;
}
export interface AgentDescriptor {
  id: string; name: string; command: string; args: string[]; enabled: boolean; is_default: boolean;
  last_probe: ProbeResult | null;
}
// agent:// 事件 payload（src-tauri/src/models.rs Acp*Event）
export interface AcpStreamEvent { session_id: number; text: string }
export interface AcpPermissionOption { option_id: string; name: string; kind: string } // kind: allow_* | reject_*
export interface AcpPermissionEvent { session_id: number; request_id: string; title: string; options: AcpPermissionOption[] }
export interface AcpTurnEvent { session_id: number; ok: boolean; content: string | null; error: string | null }

// ---- M2-T7：章节快照版本历史 ----
export interface SnapshotInfo { file: string; ts: string; words: number; title: string }

// ---- M2-T8：导入导出 ----
export interface ParsedChapter { title: string; content: string; volume: string | null } // volume 仅用于预览分组，不落库
export interface ImportReport { chapters: number; words: number }

// ---- M2-T9：全书搜索（match_* 为字符索引，非字节） ----
export interface SearchHit {
  chapter_id: number; chapter_title: string; line_no: number;
  line_text: string; match_start: number; match_end: number;
}
export interface SearchResult { hits: SearchHit[]; truncated: boolean }

// ---- M2-T10：碰碰车（ideas 的 words_json/tags_json 是 JSON 数组字符串） ----
export interface BumpWord { id: number; word: string; created_at: string }
export interface Idea {
  id: number; content: string; words_json: string; tags_json: string; created_at: string;
}

// ---- M2-T11：写作统计与敏感词 ----
export interface WritingStat { date: string; book_id: number; words: number; active_minutes: number }
export interface SensitiveHit { word: string; byte_start: number; context: string }

// ---- M3-T1：伏笔 / 按日聚合统计（settings 为通用 KV，阅读进度等也走这里） ----
export interface Foreshadow {
  id: number; book_id: number; title: string;
  planted_chapter_id: number; target_chapter_id: number | null;
  status: string; note: string; created_at: string; resolved_chapter_id: number | null;
  /** M4-T5 还债登记：放行理由 + 登记的还债章（null=未登记） */
  override_note: string; repay_chapter_id: number | null;
}
export interface ForeshadowInput {
  id: number | null; book_id: number; title: string;
  planted_chapter_id: number; target_chapter_id: number | null; note: string;
  override_note: string; repay_chapter_id: number | null;
}
export interface DailyStat { date: string; words: number; active_minutes: number }

// ---- M4：人物卡（图谱底座） ----
export interface Character {
  id: number; book_id: number; name: string; role: string;
  aliases: string; description: string; created_at: string; updated_at: string;
}
export interface CharacterInput {
  id: number | null; book_id: number; name: string;
  role: string; aliases: string; description: string;
}

// ---- M4：大纲体系（master=总纲 / volume=卷纲 / chapter=章细纲） ----
export type OutlineKind = "master" | "volume" | "chapter";
export interface Outline {
  id: number; book_id: number; kind: OutlineKind;
  chapter_id: number | null; title: string; content: string;
  sort_key: number; created_at: string; updated_at: string;
}
export interface OutlineInput {
  id: number | null; book_id: number; kind: OutlineKind;
  chapter_id: number | null; title: string; content: string; sort_key: number;
}

// ---- M4：素材库（全局）/ 情节块（按书） ----
export interface Material {
  id: number; title: string; category: string;
  content: string; tags: string; created_at: string; updated_at: string;
}
export interface MaterialInput {
  id: number | null; title: string; category: string; content: string; tags: string;
}
export type PlotBlockStatus = "idea" | "ready" | "used";
export interface PlotBlock {
  id: number; book_id: number; content: string; status: PlotBlockStatus;
  chapter_id: number | null; sort_key: number; created_at: string;
}
export interface PlotBlockInput {
  id: number | null; book_id: number; content: string; status: PlotBlockStatus;
  chapter_id: number | null; sort_key: number;
}

// ---- M3-T6：阅读背景图（文件存 {appData}/background/，经 asset 协议加载） ----
export interface BgImage { id: string; path: string; name: string }

// ---- M5 图谱：角色关系 / 世界地图（图片存 {appData}/maps/，经 asset 协议加载） ----
export interface CharacterRelation {
  id: number; book_id: number; source_id: number; target_id: number;
  relation_type: string; note: string; created_at: string; updated_at: string;
}
export interface CharacterRelationInput {
  id: number | null; book_id: number; source_id: number; target_id: number;
  relation_type: string; note: string;
}
export interface WorldMap {
  id: number; book_id: number; name: string; path: string;
  created_at: string; updated_at: string;
}
export interface Place {
  id: number; book_id: number; map_id: number; name: string; description: string;
  linked_character_ids: string; x: number; y: number;
  created_at: string; updated_at: string;
}
export interface PlaceInput {
  id: number | null; map_id: number; name: string; description: string;
  linked_character_ids: string; x: number; y: number;
}

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
  // ---- M2：ACP agent 注册表与会话 ----
  agentsList: () => invoke<AgentDescriptor[]>("agents_list"),
  agentsProbe: (id: string) => invoke<ProbeResult>("agents_probe", { id }),
  agentsUpsert: (desc: AgentDescriptor) => invoke<void>("agents_upsert", { desc }),
  agentsRemove: (id: string) => invoke<void>("agents_remove", { id }),
  agentsSetDefault: (id: string) => invoke<void>("agents_set_default", { id }),
  sendMessageAcp: (sessionId: number, instruction: string) =>
    invoke<ChatMessage>("send_message_acp", { sessionId, instruction }),
  cancelGenerationAcp: (sessionId: number) => invoke<void>("cancel_generation_acp", { sessionId }),
  agentsRespondPermission: (sessionId: number, requestId: string, optionId: string) =>
    invoke<void>("agents_respond_permission", { sessionId, requestId, optionId }),
  // ---- M2-T7：章节快照版本历史 ----
  listHistory: (chapterId: number) => invoke<SnapshotInfo[]>("list_history", { chapterId }),
  readHistory: (chapterId: number, file: string) => invoke<string>("read_history", { chapterId, file }),
  // 恢复旧版前先补存当前编辑器内容（运行时传入，故防抖窗口内的输入也不丢）
  snapshotNow: (chapterId: number, content: string) => invoke<boolean>("snapshot_now", { chapterId, content }),
  // ---- M2-T8：导入导出 ----
  previewImport: (path: string) => invoke<ParsedChapter[]>("preview_import", { path }),
  // M4-T3 文件夹成书导入：目录内 *.md/*.txt 按文件名自然序一文件一章
  previewImportDir: (path: string) => invoke<ParsedChapter[]>("preview_import_dir", { path }),
  // M4-T4 导入查重：预览内容与目标书已落库章逐条比对（true=疑似重复）
  checkDuplicates: (bookId: number, contents: string[]) =>
    invoke<boolean[]>("check_duplicates", { bookId, contents }),
  importChapters: (bookId: number, chapters: ParsedChapter[]) =>
    invoke<ImportReport>("import_chapters", { bookId, chapters }),
  // chapterIds 为空数组 = 导出全书；dest 由前端文件对话框给出
  exportTxt: (bookId: number, chapterIds: number[], indent: boolean, dest: string) =>
    invoke<void>("export_txt", { bookId, chapterIds, indent, dest }),
  exportDocx: (bookId: number, chapterIds: number[], dest: string) =>
    invoke<void>("export_docx", { bookId, chapterIds, dest }),
  // ---- M2-T9：全书搜索 ----
  searchBook: (bookId: number, query: string, wholeWord: boolean) =>
    invoke<SearchResult>("search_book", { bookId, query, wholeWord }),
  // ---- M2-T10：碰碰车 ----
  bumpListWords: () => invoke<BumpWord[]>("bump_list_words"),
  bumpAddWord: (word: string) => invoke<BumpWord>("bump_add_word", { word }),
  bumpDeleteWord: (id: number) => invoke<void>("bump_delete_word", { id }),
  bumpClearWords: () => invoke<void>("bump_clear_words"),
  bumpDraw: (count: number) => invoke<string[]>("bump_draw", { count }),
  ideasList: () => invoke<Idea[]>("ideas_list"),
  ideasCreate: (content: string, wordsJson: string, tagsJson: string) =>
    invoke<Idea>("ideas_create", { content, wordsJson, tagsJson }),
  ideasDelete: (id: number) => invoke<void>("ideas_delete", { id }),
  // ---- M2-T11：写作统计与敏感词 ----
  statsAdd: (bookId: number, deltaWords: number, countMinute: boolean) =>
    invoke<void>("stats_add", { bookId, deltaWords, countMinute }),
  statsToday: (bookId: number) => invoke<WritingStat>("stats_today", { bookId }),
  sensitiveGetWords: () => invoke<string[]>("sensitive_get_words"),
  sensitiveSetWords: (words: string[]) => invoke<string[]>("sensitive_set_words", { words }),
  sensitiveScan: (content: string) => invoke<SensitiveHit[]>("sensitive_scan", { content }),
  sensitiveImportWords: (path: string) => invoke<string[]>("sensitive_import_words", { path }),
  // ---- M3-T1：通用设置 KV / 按日统计 / 完本目标 / 伏笔 ----
  settingGet: (key: string) => invoke<string | null>("setting_get", { key }),
  settingSet: (key: string, value: string) => invoke<void>("setting_set", { key, value }),
  statsRange: (days: number, bookId: number | null) =>
    invoke<DailyStat[]>("stats_range", { days, bookId }),
  booksSetTarget: (bookId: number, targetWords: number | null) =>
    invoke<Book>("books_set_target", { bookId, targetWords }),
  foreshadowsList: (bookId: number) => invoke<Foreshadow[]>("foreshadows_list", { bookId }),
  foreshadowUpsert: (input: ForeshadowInput) => invoke<Foreshadow>("foreshadow_upsert", { input }),
  foreshadowSetStatus: (id: number, status: string, resolvedChapterId: number | null) =>
    invoke<Foreshadow>("foreshadow_set_status", { id, status, resolvedChapterId }),
  foreshadowDelete: (id: number) => invoke<void>("foreshadow_delete", { id }),
  charactersList: (bookId: number) => invoke<Character[]>("characters_list", { bookId }),
  characterUpsert: (input: CharacterInput) => invoke<Character>("character_upsert", { input }),
  characterDelete: (id: number) => invoke<void>("character_delete", { id }),
  // ---- M5 图谱：角色关系 / 世界地图 ----
  relationsList: (bookId: number) => invoke<CharacterRelation[]>("relations_list", { bookId }),
  relationUpsert: (input: CharacterRelationInput) =>
    invoke<CharacterRelation>("relation_upsert", { input }),
  relationDelete: (id: number) => invoke<void>("relation_delete", { id }),
  mapsList: (bookId: number) => invoke<WorldMap[]>("maps_list", { bookId }),
  mapImport: (bookId: number, name: string, srcPath: string) =>
    invoke<WorldMap>("map_import", { bookId, name, srcPath }),
  mapRename: (id: number, name: string) => invoke<WorldMap>("map_rename", { id, name }),
  mapDelete: (id: number) => invoke<void>("map_delete", { id }),
  placesList: (mapId: number) => invoke<Place[]>("places_list", { mapId }),
  placeUpsert: (input: PlaceInput) => invoke<Place>("place_upsert", { input }),
  placeDelete: (id: number) => invoke<void>("place_delete", { id }),
  outlinesList: (bookId: number) => invoke<Outline[]>("outlines_list", { bookId }),
  outlineUpsert: (input: OutlineInput) => invoke<Outline>("outline_upsert", { input }),
  outlineDelete: (id: number) => invoke<void>("outline_delete", { id }),
  materialsList: (query?: string) =>
    invoke<Material[]>("materials_list", { query: query ?? null }),
  materialUpsert: (input: MaterialInput) => invoke<Material>("material_upsert", { input }),
  materialDelete: (id: number) => invoke<void>("material_delete", { id }),
  plotBlocksList: (bookId: number) => invoke<PlotBlock[]>("plot_blocks_list", { bookId }),
  plotBlockUpsert: (input: PlotBlockInput) => invoke<PlotBlock>("plot_block_upsert", { input }),
  plotBlockReorder: (ids: number[]) => invoke<void>("plot_block_reorder", { ids }),
  plotBlockDelete: (id: number) => invoke<void>("plot_block_delete", { id }),
  // ---- M3-T6：阅读背景图 ----
  readingBgImport: (srcPath: string) => invoke<BgImage>("reading_bg_import", { srcPath }),
  readingBgList: () => invoke<BgImage[]>("reading_bg_list"),
  readingBgDelete: (id: string) => invoke<void>("reading_bg_delete", { id }),
};
