import { useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2, X } from "lucide-react";
import { useMaterials } from "../../stores/materials";
import { Badge } from "../ui/Badge";
import { Card } from "../ui/Card";

// 素材库工作区（M4 一级视图主体，全局不分书）。
// 搜索（标题/分类/内容/标签）+ 按分类分组卡片 + 新建/编辑/删除。
// 分类是自由文本——网文素材的分类体系因人而异，不预设枚举。

const INPUT =
  "rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-sm text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

interface FormState {
  id: number | null;
  title: string;
  category: string;
  content: string;
  tags: string;
}

const EMPTY: FormState = { id: null, title: "", category: "", content: "", tags: "" };

export function MaterialsWorkspace() {
  const list = useMaterials((s) => s.list);
  const load = useMaterials((s) => s.load);
  const upsert = useMaterials((s) => s.upsert);
  const remove = useMaterials((s) => s.remove);

  const [search, setSearch] = useState("");
  const [form, setForm] = useState<FormState | null>(null);
  const [confirmDelId, setConfirmDelId] = useState<number | null>(null);

  useEffect(() => {
    void load("");
  }, [load]);

  // 搜索防抖 300ms
  useEffect(() => {
    const t = setTimeout(() => void load(search), 300);
    return () => clearTimeout(t);
  }, [search, load]);

  const submit = async () => {
    if (!form || !form.title.trim()) return;
    const ok = await upsert({
      id: form.id,
      title: form.title,
      category: form.category,
      content: form.content,
      tags: form.tags,
    });
    if (ok) setForm(null);
  };

  // 分类分组（后端已按分类排序聚拢，这里只切组）
  const groups: { category: string; items: typeof list }[] = [];
  for (const m of list) {
    const c = m.category || "未分类";
    const last = groups[groups.length - 1];
    if (last && last.category === c) last.items.push(m);
    else groups.push({ category: c, items: [m] });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* 工具条：搜索 + 新建 */}
      <div className="flex shrink-0 gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[color:var(--text-faint)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜素材（标题 / 分类 / 内容 / 标签）"
            className={`${INPUT} w-full pl-8`}
          />
        </div>
        <button
          onClick={() => setForm({ ...EMPTY })}
          className="flex shrink-0 items-center gap-1 rounded-md border border-[color:var(--border-subtle)] px-3 text-sm text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
        >
          <Plus size={14} /> 新建
        </button>
      </div>

      {/* 编辑表单 */}
      {form && (
        <div className="flex shrink-0 flex-col gap-2 rounded-lg border border-[color:var(--border-strong)] bg-[var(--bg-elevated)] p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="素材名（必填，如：幽冥湖）"
              className={`${INPUT} flex-1`}
            />
            <input
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
              placeholder="分类（如：地名）"
              className={`${INPUT} w-36`}
            />
          </div>
          <textarea
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
            placeholder="内容：设定描述 / 出处 / 用法……"
            className={`${INPUT} min-h-24 resize-y text-xs leading-relaxed`}
          />
          <div className="flex items-center gap-2">
            <input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="标签（逗号分隔）"
              className={`${INPUT} flex-1`}
            />
            <button
              onClick={() => setForm(null)}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
            >
              <X size={12} /> 取消
            </button>
            <button
              onClick={() => void submit()}
              disabled={!form.title.trim()}
              className="rounded-md bg-[color:var(--accent)] px-3 py-1 text-xs font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </div>
      )}

      {/* 分组列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[color:var(--text-faint)]">
            <div>{search ? "没有匹配的素材" : "素材库还是空的"}</div>
            {!search && <div className="text-xs">把反复要用的地名、门派、道具、金句都存在这里</div>}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.category} className="mb-4">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">{g.category}</span>
                <span className="text-[11px] text-[color:var(--text-faint)]">{g.items.length}</span>
                <span className="h-px flex-1 bg-[color:var(--border-subtle)]" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {g.items.map((m) => (
                  <Card key={m.id} interactive className="flex flex-col gap-2">
                    <div className="flex items-start gap-1">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[color:var(--text-primary)]" title={m.title}>
                        {m.title}
                      </span>
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100">
                        <button
                          title="编辑"
                          onClick={() =>
                            setForm({ id: m.id, title: m.title, category: m.category, content: m.content, tags: m.tags })
                          }
                          className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-secondary)]"
                        >
                          <Pencil size={14} />
                        </button>
                        {confirmDelId === m.id ? (
                          <button
                            onClick={() => {
                              void remove(m.id);
                              setConfirmDelId(null);
                            }}
                            className="rounded bg-[color:var(--danger)]/15 px-1.5 py-1 text-xs text-[color:var(--danger)] transition-colors duration-150 hover:bg-[color:var(--danger)]/25"
                          >
                            确认
                          </button>
                        ) : (
                          <button
                            title="删除"
                            onClick={() => setConfirmDelId(m.id)}
                            className="rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {m.content && (
                      <div className="line-clamp-3 whitespace-pre-wrap text-xs leading-relaxed text-[color:var(--text-secondary)]">
                        {m.content}
                      </div>
                    )}
                    {m.tags && (
                      <div className="flex flex-wrap gap-1">
                        {m.tags.split(",").filter(Boolean).map((t) => (
                          <Badge key={t} tone="neutral">{t.trim()}</Badge>
                        ))}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
