import { useEffect, useState } from "react";
import { useWorkspace } from "../../stores/workspace";

export function Sidebar() {
  const { books, chapters, currentBookId, currentChapterId, loadBooks, selectBook, createBook, createChapter, selectChapter } = useWorkspace();
  const [newBook, setNewBook] = useState("");
  const [newChapter, setNewChapter] = useState("");

  useEffect(() => { loadBooks(); }, [loadBooks]);

  return (
    <div className="flex h-full flex-col bg-[var(--bg-panel)] text-sm">
      <div className="border-b p-2" style={{ borderColor: "var(--border)" }}>
        <div className="mb-1 font-medium text-[var(--fg-dim)]">书籍</div>
        {books.map((b) => (
          <div key={b.id}
            onClick={() => selectBook(b.id)}
            className={`cursor-pointer rounded px-2 py-1 ${currentBookId === b.id ? "bg-[var(--accent)]/20 text-white" : "hover:bg-white/5"}`}>
            {b.title}
          </div>
        ))}
        <div className="mt-1 flex gap-1">
          <input value={newBook} onChange={(e) => setNewBook(e.target.value)} placeholder="新书名…"
            className="w-full rounded border bg-transparent px-1 py-0.5" style={{ borderColor: "var(--border)" }} />
          <button onClick={async () => { if (newBook.trim()) { await createBook(newBook.trim()); setNewBook(""); } }}
            className="rounded px-2 py-0.5" style={{ background: "var(--accent)" }}>＋</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-1 font-medium text-[var(--fg-dim)]">章节</div>
        {chapters.map((c) => (
          <div key={c.id}
            onClick={() => selectChapter(c.id)}
            className={`cursor-pointer rounded px-2 py-1 ${currentChapterId === c.id ? "bg-[var(--accent)]/20 text-white" : "hover:bg-white/5"}`}>
            {c.title}
          </div>
        ))}
        {currentBookId != null && (
          <div className="mt-1 flex gap-1">
            <input value={newChapter} onChange={(e) => setNewChapter(e.target.value)} placeholder="新章节…"
              className="w-full rounded border bg-transparent px-1 py-0.5" style={{ borderColor: "var(--border)" }} />
            <button onClick={async () => { if (newChapter.trim()) { await createChapter(newChapter.trim()); setNewChapter(""); } }}
              className="rounded px-2 py-0.5" style={{ background: "var(--accent)" }}>＋</button>
          </div>
        )}
      </div>
    </div>
  );
}
