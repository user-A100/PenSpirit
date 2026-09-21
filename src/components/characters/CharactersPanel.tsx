import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useCharacters } from "../../stores/characters";
import { useRelations } from "../../stores/relations";
import { useWorkspace } from "../../stores/workspace";
import { Badge } from "../ui/Badge";

// 人物卡面板（M4，write 视图 dock 的 characters tab）——人物图谱的第一块底座：
// 姓名必填，角色/别名（逗号分隔）/描述可选；别名供后续检索与图谱消歧用。
// 关系数 Badge（M5）随 useRelations 计数，编辑入口在图谱视图（点节点弹窗）。

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 focus:border-[color:var(--accent)]";
const SECTION = "mb-1 text-xs font-medium text-[color:var(--text-secondary)]";
const ICON_BTN =
  "rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)]";

export function CharactersPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const list = useCharacters((s) => s.list);
  const load = useCharacters((s) => s.load);
  const upsert = useCharacters((s) => s.upsert);
  const remove = useCharacters((s) => s.remove);
  const relList = useRelations((s) => s.list);
  const loadRels = useRelations((s) => s.load);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [aliases, setAliases] = useState("");
  const [desc, setDesc] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load(currentBookId);
    void loadRels(currentBookId);
  }, [currentBookId, load, loadRels]);

  const relCount = (charId: number) =>
    relList.filter((r) => r.source_id === charId || r.target_id === charId).length;

  const openCreate = () => {
    setEditingId(null);
    setName("");
    setRole("");
    setAliases("");
    setDesc("");
    setError(null);
    setFormOpen(true);
  };

  const openEdit = (c: typeof list[number]) => {
    setEditingId(c.id);
    setName(c.name);
    setRole(c.role);
    setAliases(c.aliases);
    setDesc(c.description);
    setError(null);
    setFormOpen(true);
  };

  const save = async () => {
    if (currentBookId == null || !name.trim()) {
      setError("姓名不能为空");
      return;
    }
    const ok = await upsert({
      id: editingId,
      book_id: currentBookId,
      name: name.trim(),
      role,
      aliases,
      description: desc,
    });
    if (!ok) {
      setError("保存失败，请重试");
      return;
    }
    setFormOpen(false);
  };

  if (currentBookId == null) {
    return <div className="p-4 text-xs text-[color:var(--text-faint)]">请先选择书籍</div>;
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className={SECTION}>人物卡（{list.length}）</span>
        {!formOpen && (
          <button
            onClick={openCreate}
            title="新建人物卡"
            className="flex items-center gap-1 rounded-md border border-[color:var(--border-subtle)] px-2 py-1 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            <Plus size={12} />
            新建
          </button>
        )}
      </div>

      {formOpen && (
        <div className="mb-3 space-y-1.5 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-2.5">
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="姓名（必填）"
              autoFocus
              className={INPUT}
            />
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="角色：主角/配角/反派…"
              className={INPUT}
            />
            <button onClick={() => setFormOpen(false)} title="取消" className={ICON_BTN}>
              <X size={13} />
            </button>
          </div>
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="别名（逗号分隔，供检索/图谱消歧）"
            className={INPUT}
          />
          <textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="设定：身份/性格/目标…"
            rows={3}
            className={`${INPUT} resize-none`}
          />
          {error && <div className="text-xs text-[color:var(--danger)]">{error}</div>}
          <button
            onClick={() => void save()}
            className="rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)]"
          >
            {editingId == null ? "创建" : "保存"}
          </button>
        </div>
      )}

      {list.length === 0 && !formOpen ? (
        <div className="px-2 py-8 text-center text-xs text-[color:var(--text-faint)]">
          还没有人物卡——「新建」登记第一个人物
        </div>
      ) : (
        <div className="space-y-1.5">
          {list.map((c) => (
            <div
              key={c.id}
              className="rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] p-2.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[color:var(--text-primary)]">{c.name}</span>
                {c.role && <Badge tone="purple">{c.role}</Badge>}
                {relCount(c.id) > 0 && (
                  <Badge tone="neutral" title="在图谱视图中点角色可编辑关系">
                    {relCount(c.id)} 关系
                  </Badge>
                )}
                <span className="flex-1" />
                <button onClick={() => openEdit(c)} title="编辑" className={ICON_BTN}>
                  <Pencil size={12} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm(`删除人物卡「${c.name}」？`)) void remove(c.id);
                  }}
                  title="删除"
                  className={ICON_BTN}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              {c.aliases && (
                <div className="mt-1 text-[11px] text-[color:var(--text-faint)]">别名：{c.aliases}</div>
              )}
              {c.description && (
                <div className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[color:var(--text-secondary)]">
                  {c.description}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
