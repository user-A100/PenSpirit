import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import { PenLine } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { api } from "../../lib/tauri";
import { useAutosave } from "../../hooks/useAutosave";
import { countWords } from "../../lib/words";

export function ChapterEditor() {
  const { books, currentBookId, currentChapterId, chapterContent, chapters } = useWorkspace();
  const dirty = useRef<string | null>(null);
  const chapterIdRef = useRef<number | null>(null);
  chapterIdRef.current = currentChapterId;

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor: ed }) => {
      dirty.current = (ed.storage.markdown as { getMarkdown(): string }).getMarkdown();
    },
  });

  useEffect(() => {
    if (editor && chapterContent != null) {
      editor.commands.setContent(chapterContent);
      dirty.current = null;
    }
  }, [currentChapterId, chapterContent, editor]);

  const { status } = useAutosave(
    () => dirty.current,
    async (content) => {
      const id = chapterIdRef.current;
      if (id == null) return;
      await api.writeChapter(id, content);
    },
  );

  const book = books.find((b) => b.id === currentBookId);
  const meta = chapters.find((c) => c.id === currentChapterId);

  if (currentChapterId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-[var(--bg-base)]">
        <PenLine size={32} strokeWidth={1.5} className="text-[color:var(--text-faint)]" />
        <div className="text-sm text-[color:var(--text-secondary)]">选择或创建一个章节开始写作</div>
        <div className="text-xs text-[color:var(--text-faint)]">Ctrl+N 快速新建（即将支持）</div>
      </div>
    );
  }

  const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ") ?? "";

  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)]">
      {/* 顶部栏 40px：面包屑 + 保存状态 + 字数 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-4 border-b border-[color:var(--border-subtle)] pl-4 pr-5">
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <span className="truncate text-[color:var(--text-secondary)]">{book?.title ?? ""}</span>
          <span className="shrink-0 text-[color:var(--text-faint)]">/</span>
          <span className="truncate text-[color:var(--text-primary)]">{meta?.title ?? ""}</span>
        </div>
        <div className="flex shrink-0 items-center gap-3 text-xs text-[color:var(--text-faint)]">
          {status !== "idle" && (
            <span className="flex items-center gap-1.5">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  status === "saving" ? "animate-pulse bg-[color:var(--warning)]" : "bg-[color:var(--success)]"
                }`}
              />
              {status === "saving" ? "保存中" : "已保存"}
            </span>
          )}
          <span>{countWords(text).toLocaleString()} 字</span>
        </div>
      </div>

      {/* 正文：720px 单列衬线排版，无边框融入背景 */}
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="prose-serif mx-auto max-w-[720px] px-8 py-10" />
      </div>
    </div>
  );
}
