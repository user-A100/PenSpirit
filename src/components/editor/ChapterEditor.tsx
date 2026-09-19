import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef } from "react";
import { useWorkspace } from "../../stores/workspace";
import { api } from "../../lib/tauri";
import { useAutosave } from "../../hooks/useAutosave";
import { countWords } from "../../lib/words";

export function ChapterEditor() {
  const { currentChapterId, chapterContent, chapters } = useWorkspace();
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

  const meta = chapters.find((c) => c.id === currentChapterId);

  if (currentChapterId == null) {
    return <div className="flex h-full items-center justify-center text-[var(--fg-dim)]">选择或创建一个章节开始写作</div>;
  }

  const text = editor?.state.doc.textBetween(0, editor.state.doc.content.size, "\n", " ") ?? "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2" style={{ borderColor: "var(--border)" }}>
        <div className="font-medium">{meta?.title ?? ""}</div>
        <div className="text-xs text-[var(--fg-dim)]">
          {countWords(text)} 字 · {status === "saving" ? "保存中…" : status === "saved" ? "已保存" : ""}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <EditorContent editor={editor} className="mx-auto max-w-3xl px-8 py-6 leading-8" />
      </div>
    </div>
  );
}
