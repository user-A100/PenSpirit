import { useState } from "react";
import { PenLine, Plus, Save, Star, Trash2, X } from "lucide-react";
import { Modal } from "../ui/Modal";
import { useTemplates } from "../../stores/templates";
import { useWorkspace } from "../../stores/workspace";
import type { ChapterTemplate } from "../../lib/tauri";

// 章节模板管理（Scrivener Template Sheets 移植）：
// 列表 + 新建/编辑（名字 + 正文）/ 设默认（新章自动套用）/ 删除。
// 「当前章存为模板」取 workspace.chapterContent（防抖窗口内的最近一次保存）。

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

export function TemplateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useTemplates((s) => s.list);
  const { upsert, remove, setDefault } = useTemplates();
  const bookId = useWorkspace((s) => s.currentBookId);
  const chapters = useWorkspace((s) => s.chapters);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const chapterContent = useWorkspace((s) => s.chapterContent);
  const currentChapter = chapters.find((c) => c.id === currentChapterId) ?? null;

  const [editing, setEditing] = useState<ChapterTemplate | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  const startNew = () => {
    setEditing(null);
    setDrafting(true);
    setName("");
    setContent("");
  };
  const startEdit = (t: ChapterTemplate) => {
    setDrafting(false);
    setEditing(t);
    setName(t.name);
    setContent(t.content);
  };
  const save = async () => {
    if (bookId == null || !name.trim()) return;
    await upsert({ id: editing?.id ?? null, book_id: bookId, name: name.trim(), content, is_default: editing?.is_default ?? false });
    startNew();
  };
  const saveCurrentAsTemplate = async () => {
    if (bookId == null || currentChapter == null) return;
    await upsert({ id: null, book_id: bookId, name: `${currentChapter.title} 模板`, content: chapterContent ?? "", is_default: false });
    startNew();
  };

  return (
    <Modal open={open} onClose={onClose} title="章节模板" widthClass="max-w-2xl">
      <div className="flex min-h-0 flex-1">
        {/* 左列：模板清单 */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-[color:var(--border-subtle)] p-2">
          {list.length === 0 && (
            <div className="px-2 py-6 text-center text-xs leading-relaxed text-[color:var(--text-faint)]">
              还没有模板
              <br />右侧写好名字与骨架即可保存
            </div>
          )}
          {list.map((t) => (
            <div
              key={t.id}
              className={`group mb-1 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors duration-150 ${
                editing?.id === t.id ? "bg-[var(--accent-dim)]" : "hover:bg-[var(--bg-hover)]"
              }`}
              onClick={() => startEdit(t)}
            >
              <Star
                size={12}
                className={t.is_default ? "shrink-0 fill-[color:var(--accent)] text-[color:var(--accent)]" : "shrink-0 text-transparent"}
              />
              <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{t.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void setDefault(t.id, !t.is_default);
                }}
                title={t.is_default ? "取消默认" : "设为默认（新章自动套用）"}
                className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-[color:var(--accent-hover)]"
              >
                <Star size={12} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(t.id);
                  if (editing?.id === t.id) startNew();
                }}
                title="删除模板"
                className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-[color:var(--accent-hover)]"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            onClick={startNew}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
          >
            <Plus size={12} />
            新建模板
          </button>
          {currentChapter != null && (
            <button
              onClick={() => void saveCurrentAsTemplate()}
              title="把当前章的正文存为新模板"
              className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
            >
              <PenLine size={12} />
              当前章存为模板
            </button>
          )}
        </div>

        {/* 右列：编辑区 */}
        <div className="flex min-w-0 flex-1 flex-col p-3">
          {list.length === 0 || editing != null || drafting || name !== "" || content !== "" ? (
            <>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="模板名（如：战斗章）…"
                className={`${INPUT} mb-2`}
              />
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={14}
                placeholder={"新章的初始正文骨架，如：\n\n## 场景\n\n## 冲突\n\n## 收束\n"}
                className={`${INPUT} mb-2 flex-1 resize-none font-mono`}
              />
              <div className="flex items-center justify-end gap-2">
                {(editing != null || drafting || name !== "" || content !== "") && (
                  <button
                    onClick={startNew}
                    title="放弃编辑"
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
                  >
                    <X size={12} />
                    取消
                  </button>
                )}
                <button
                  onClick={() => void save()}
                  disabled={!name.trim()}
                  title="保存模板"
                  className="flex items-center gap-1 rounded-md bg-[var(--accent-dim)] px-2.5 py-1 text-xs text-[color:var(--accent)] transition-colors duration-150 hover:bg-[var(--bg-hover)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Save size={12} />
                  保存
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-[color:var(--text-faint)]">
              左侧选择模板编辑，或新建一个
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
