import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, ChevronDown, ChevronRight, FolderPlus, ListPlus, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, type ChapterMeta, type Collection } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";

// 集合面板（M7 批次4，Scrivener Collections 移植）：
// 手动集合=固定成员（可增删）；搜索集合=存储查询，成员实时由搜索结果决定。
// 搜索集合主要从搜索面板「存为集合」创建；这里负责浏览、跳章与手动集合维护。

export function CollectionsDockPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const selectChapter = useWorkspace((s) => s.selectChapter);
  const [cols, setCols] = useState<Collection[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [members, setMembers] = useState<ChapterMeta[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (currentBookId == null) return;
    let cancelled = false;
    setCols(null);
    api
      .collectionsList(currentBookId)
      .then((cs) => !cancelled && setCols(cs))
      .catch((e) => !cancelled && console.warn(e));
    return () => {
      cancelled = true;
    };
  }, [currentBookId, reload]);

  useEffect(() => {
    setExpanded(null);
    setMembers(null);
    setCreating(false);
    setNewName("");
    setMsg(null);
  }, [currentBookId]);

  const toggle = async (id: number) => {
    if (expanded === id) {
      setExpanded(null);
      setMembers(null);
      return;
    }
    setExpanded(id);
    setMembers(null);
    try {
      setMembers(await api.collectionChapters(id));
    } catch (e) {
      console.warn(e);
      setMembers([]);
    }
  };

  const createManual = async () => {
    const name = newName.trim();
    if (name === "" || currentBookId == null) return;
    try {
      const col = await api.collectionUpsert({ id: null, book_id: currentBookId, name, kind: "manual", query: "" });
      setNewName("");
      setCreating(false);
      setReload((v) => v + 1);
      setExpanded(col.id);
      setMembers([]);
    } catch (e) {
      setMsg(String(e).replace(/^.*?"|".*$/g, "") || String(e));
    }
  };

  const removeCollection = async (col: Collection) => {
    if (!window.confirm(`删除集合「${col.name}」？${col.kind === "manual" ? "（章节本身不受影响）" : ""}`)) return;
    try {
      await api.collectionDelete(col.id);
      if (expanded === col.id) {
        setExpanded(null);
        setMembers(null);
      }
      setReload((v) => v + 1);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const addCurrent = async (col: Collection) => {
    if (currentChapterId == null) return;
    try {
      await api.collectionAddChapters(col.id, [currentChapterId]);
      setMembers(await api.collectionChapters(col.id));
      setReload((v) => v + 1);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const removeMember = async (col: Collection, chapterId: number) => {
    try {
      await api.collectionRemoveChapter(col.id, chapterId);
      setMembers(await api.collectionChapters(col.id));
      setReload((v) => v + 1);
    } catch (e) {
      setMsg(String(e));
    }
  };

  const moveMember = async (col: Collection, index: number, direction: -1 | 1) => {
    if (!members || index + direction < 0 || index + direction >= members.length) return;
    const ids = members.map((m) => m.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    try {
      await api.collectionReorder(col.id, ids);
      setMembers(await api.collectionChapters(col.id));
      setMsg(null);
    } catch (e) {
      setMsg(String(e));
    }
  };

  if (currentBookId == null) {
    return <div className="flex h-full items-center justify-center p-4 text-xs text-[color:var(--text-faint)]">先选一本书</div>;
  }

  const manual = cols?.filter((c) => c.kind === "manual") ?? [];
  const saved = cols?.filter((c) => c.kind === "saved") ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3 text-xs" data-testid="collections-panel">
      <div className="mb-2 flex shrink-0 items-center gap-1">
        <button
          onClick={() => {
            setCreating((v) => !v);
            setMsg(null);
          }}
          title="新建手动集合"
          className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[color:var(--border-subtle)] py-1 text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
        >
          <FolderPlus size={11} />
          新建集合
        </button>
        <button
          onClick={() => setReload((v) => v + 1)}
          title="刷新（搜索集合成员随正文实时变化）"
          className="shrink-0 rounded-md border border-[color:var(--border-subtle)] p-1.5 text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
        >
          <RefreshCw size={11} className={cols == null ? "animate-spin" : ""} />
        </button>
      </div>

      {creating && (
        <div className="mb-2 flex shrink-0 items-center gap-1">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createManual();
              if (e.key === "Escape") setCreating(false);
            }}
            placeholder="集合名…"
            data-testid="collection-name-input"
            className="min-w-0 flex-1 rounded-md border border-[color:var(--border-subtle)] bg-transparent px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none focus:border-[color:var(--accent)]"
          />
          <button
            onClick={() => void createManual()}
            title="创建（手动集合）"
            className="shrink-0 rounded-md border border-[color:var(--border-subtle)] p-1 text-[color:var(--text-secondary)] transition-colors duration-150 hover:border-[color:var(--accent)] hover:text-[color:var(--text-primary)]"
          >
            <Plus size={12} />
          </button>
        </div>
      )}

      {msg && <div className="mb-2 shrink-0 text-[10px] text-[color:var(--danger)]">{msg}</div>}

      {cols != null && cols.length === 0 && (
        <div className="text-[color:var(--text-faint)]">
          还没有集合。手动集合收纳常翻的章；搜索面板里「存为集合」可把当前查询固化成搜索集合。
        </div>
      )}

      <Section title={`手动集合（${manual.length}）`}>
        {manual.length === 0 && <Empty text="暂无" />}
        {manual.map((c) => (
          <Row
            key={c.id}
            col={c}
            open={expanded === c.id}
            members={expanded === c.id ? members : null}
            currentChapterId={currentChapterId}
            onToggle={() => void toggle(c.id)}
            onDelete={() => void removeCollection(c)}
            onAddCurrent={() => void addCurrent(c)}
            onRemoveMember={(cid) => void removeMember(c, cid)}
            onMoveMember={(index, direction) => void moveMember(c, index, direction)}
            onJump={(cid) => void selectChapter(cid)}
          />
        ))}
      </Section>

      <Section title={`搜索集合（${saved.length}）`}>
        {saved.length === 0 && <Empty text="在搜索面板点「存为集合」创建" />}
        {saved.map((c) => (
          <Row
            key={c.id}
            col={c}
            open={expanded === c.id}
            members={expanded === c.id ? members : null}
            currentChapterId={null}
            onToggle={() => void toggle(c.id)}
            onDelete={() => void removeCollection(c)}
            onAddCurrent={undefined}
            onRemoveMember={undefined}
            onJump={(cid) => void selectChapter(cid)}
          />
        ))}
      </Section>
    </div>
  );
}

function Row(props: {
  col: Collection;
  open: boolean;
  members: ChapterMeta[] | null;
  currentChapterId: number | null;
  onToggle: () => void;
  onDelete: () => void;
  onAddCurrent?: () => void;
  onRemoveMember?: (chapterId: number) => void;
  onMoveMember?: (index: number, direction: -1 | 1) => void;
  onJump: (chapterId: number) => void;
}) {
  const { col } = props;
  const manual = col.kind === "manual";
  return (
    <div className="group mb-1 rounded-md border border-[color:var(--border-subtle)] transition-colors duration-150 hover:border-[color:var(--accent)]" data-testid="collection-row">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button onClick={props.onToggle} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={manual ? col.name : `搜索：${col.query}`}>
          {props.open ? (
            <ChevronDown size={11} className="shrink-0 text-[color:var(--text-faint)]" />
          ) : (
            <ChevronRight size={11} className="shrink-0 text-[color:var(--text-faint)]" />
          )}
          {manual ? (
            <ListPlus size={11} className="shrink-0 text-[color:var(--accent)]" />
          ) : (
            <Bookmark size={11} className="shrink-0 text-[color:var(--accent)]" />
          )}
          <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{col.name}</span>
        </button>
        <button
          onClick={props.onDelete}
          title="删除集合"
          className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] opacity-0 transition-all duration-150 hover:text-[color:var(--danger)] group-hover:opacity-100"
        >
          <Trash2 size={11} />
        </button>
      </div>
      {props.open && (
        <div className="border-t border-[color:var(--border-subtle)] px-1.5 py-1">
          {props.members == null ? (
            <div className="px-2 py-1 text-[10px] text-[color:var(--text-faint)]">载入中…</div>
          ) : props.members.length === 0 ? (
            <div className="px-2 py-1 text-[10px] text-[color:var(--text-faint)]">
              {manual ? "空集合" : "没有章命中当前查询"}
            </div>
          ) : (
            props.members.map((m, index) => (
              <div key={m.id} className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-[var(--bg-hover)]">
                <button
                  onClick={() => props.onJump(m.id)}
                  title={`跳到「${m.title}」`}
                  className="min-w-0 flex-1 truncate text-left text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
                >
                  {m.title}
                </button>
                {manual && props.onMoveMember && (
                  <>
                    <button
                      onClick={() => props.onMoveMember!(index, -1)}
                      disabled={index === 0}
                      title={`上移「${m.title}」`}
                      aria-label={`上移「${m.title}」`}
                      className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] enabled:hover:text-[color:var(--text-primary)] disabled:opacity-30"
                    >
                      <ArrowUp size={10} />
                    </button>
                    <button
                      onClick={() => props.onMoveMember!(index, 1)}
                      disabled={index === props.members!.length - 1}
                      title={`下移「${m.title}」`}
                      aria-label={`下移「${m.title}」`}
                      className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] enabled:hover:text-[color:var(--text-primary)] disabled:opacity-30"
                    >
                      <ArrowDown size={10} />
                    </button>
                  </>
                )}
                {manual && props.onRemoveMember && (
                  <button
                    onClick={() => props.onRemoveMember!(m.id)}
                    title="移出集合"
                    className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--danger)]"
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            ))
          )}
          {manual && props.onAddCurrent && (
            <button
              onClick={props.onAddCurrent}
              disabled={props.currentChapterId == null}
              title={props.currentChapterId == null ? "先选一章" : "把当前章加入集合"}
              className="mt-0.5 flex w-full items-center justify-center gap-1 rounded px-2 py-1 text-[10px] text-[color:var(--text-faint)] transition-colors duration-150 disabled:cursor-default enabled:hover:bg-[var(--bg-hover)] enabled:hover:text-[color:var(--text-primary)]"
            >
              <Plus size={10} />
              添加当前章
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 text-[10px] uppercase tracking-wider text-[color:var(--text-faint)]">{title}</div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="mb-1 rounded-md px-2 py-1.5 text-[color:var(--text-faint)]">{text}</div>;
}
