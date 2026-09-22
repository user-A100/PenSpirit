import { useState } from "react";
import { ChevronDown, ChevronUp, Plus, Settings2, X } from "lucide-react";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import type { CustomFieldDef } from "../../lib/tauri";

// 章节「元数据」dock 面板（M7 批次1，Scrivener Inspector 的元数据节移植）：
// 梗概（独立于正文的展示字段）/ 状态（单选下拉）/ 标签（彩色单选）
// / 目标字数（含进度）/ 关键词（书内词库 + 章内多挂）。
// 定义管理（增删改名改色）内联在「管理定义」展开区，不做弹窗。

const INPUT =
  "w-full rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2 py-1 text-xs leading-relaxed text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]";

function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center justify-between">
      <span className="text-xs text-[color:var(--text-faint)]">{children}</span>
      {right}
    </div>
  );
}

export function MetaDockPanel() {
  const currentBookId = useWorkspace((s) => s.currentBookId);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const chapters = useWorkspace((s) => s.chapters);
  const labels = useMeta((s) => s.labels);
  const statuses = useMeta((s) => s.statuses);
  const keywords = useMeta((s) => s.keywords);
  const chapterKeywords = useMeta((s) => s.chapterKeywords);
  const customDefs = useMeta((s) => s.customDefs);
  const customValues = useMeta((s) => s.customValues);
  const { updateChapterMeta, toggleChapterKeyword, createKeyword, deleteKeyword, labelUpsert, labelDelete, statusUpsert, statusDelete, setCustomValue, customDefUpsert, customDefDelete } = useMeta();

  const [kwDraft, setKwDraft] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newStatus, setNewStatus] = useState("");
  // 新字段定义草稿：名字 + 类型（list 型多一个选项草稿，逗号分隔）
  const [newField, setNewField] = useState("");
  const [newFieldType, setNewFieldType] = useState<CustomFieldDef["field_type"]>("text");
  const [newFieldOptions, setNewFieldOptions] = useState("");

  const chapter = chapters.find((c) => c.id === currentChapterId) ?? null;

  if (currentBookId == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[color:var(--text-faint)]">
        <div>先选一本书</div>
        <div className="text-xs">梗概、标签、状态、关键词按书归档</div>
      </div>
    );
  }
  if (chapter == null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-[color:var(--text-faint)]">
        <div>先选一章</div>
        <div className="text-xs">元数据挂在章节上，随章节切换</div>
      </div>
    );
  }

  const progress =
    chapter.target_words != null && chapter.target_words > 0
      ? Math.min(100, Math.round((chapter.word_count / chapter.target_words) * 100))
      : null;

  const submitKeyword = async () => {
    const title = kwDraft.trim();
    if (!title) return;
    const existing = keywords.find((k) => k.title === title);
    if (existing) {
      await toggleChapterKeyword(existing.id);
    } else {
      const kw = await createKeyword(title);
      if (kw) await toggleChapterKeyword(kw.id);
    }
    setKwDraft("");
  };

  const FIELD_TYPE_LABEL: Record<CustomFieldDef["field_type"], string> = {
    text: "文本",
    checkbox: "勾选",
    list: "列表",
    date: "日期",
  };

  const submitNewField = async () => {
    const name = newField.trim();
    if (!name) return;
    const list_options =
      newFieldType === "list"
        ? JSON.stringify(newFieldOptions.split(/[,，]/).map((s) => s.trim()).filter(Boolean))
        : "[]";
    try {
      await customDefUpsert({ id: null, name, field_type: newFieldType, list_options });
      setNewField("");
      setNewFieldOptions("");
    } catch (e) {
      console.warn(e);
    }
  };

  /** list 型定义的选项数组（list_options 为 JSON 字符串数组） */
  const optionsOf = (d: CustomFieldDef): string[] => {
    try {
      return JSON.parse(d.list_options) as string[];
    } catch {
      return [];
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-[color:var(--border-subtle)] px-3 py-2 text-sm font-medium text-[color:var(--text-primary)]">
        {chapter.title}
      </div>

      {/* 大纲梗概：独立于正文的展示字段（卡片墙/大纲列用），失焦保存 */}
      <div className="border-b border-[color:var(--border-subtle)] p-3">
        <SectionTitle>大纲梗概</SectionTitle>
        <textarea
          key={chapter.id}
          rows={4}
          defaultValue={chapter.synopsis}
          placeholder="这一章讲什么（一两句话，导出不带）…"
          onBlur={(e) => {
            if (e.target.value !== chapter.synopsis) {
              void updateChapterMeta({ synopsis: e.target.value });
            }
          }}
          className={`${INPUT} resize-none`}
        />
      </div>

      {/* 写作状态（单选下拉） */}
      <div className="border-b border-[color:var(--border-subtle)] p-3">
        <SectionTitle>状态</SectionTitle>
        <select
          key={`st-${chapter.id}`}
          aria-label="写作状态"
          value={chapter.status_id ?? ""}
          onChange={(e) => {
            void updateChapterMeta({ status_id: e.target.value === "" ? null : Number(e.target.value) });
          }}
          className={INPUT}
        >
          <option value="">未设置</option>
          {statuses.map((st) => (
            <option key={st.id} value={st.id}>{st.title}</option>
          ))}
        </select>
      </div>

      {/* 彩色标签（单选色块；再点一次取消） */}
      <div className="border-b border-[color:var(--border-subtle)] p-3">
        <SectionTitle>标签</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {labels.length === 0 && (
            <span className="text-xs text-[color:var(--text-faint)]">尚无标签定义</span>
          )}
          {labels.map((l) => {
            const active = chapter.label_id === l.id;
            return (
              <button
                key={l.id}
                title={`${l.title}${active ? "（点击取消）" : ""}`}
                onClick={() => void updateChapterMeta({ label_id: active ? null : l.id })}
                className={`flex h-6 items-center gap-1 rounded-full px-2 text-xs transition-all duration-150 ${
                  active
                    ? "text-[color:var(--text-primary)] outline outline-2 outline-[color:var(--accent)]"
                    : "text-[color:var(--text-secondary)] hover:outline hover:outline-1 hover:outline-[color:var(--border-strong,var(--border-subtle))]"
                }`}
                style={{ backgroundColor: `${l.color}26` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: l.color }} />
                {l.title}
              </button>
            );
          })}
        </div>
      </div>

      {/* 目标字数 + 进度 */}
      <div className="border-b border-[color:var(--border-subtle)] p-3">
        <SectionTitle>目标字数</SectionTitle>
        <div className="flex items-center gap-2">
          <input
            key={`tw-${chapter.id}`}
            type="number"
            min={0}
            defaultValue={chapter.target_words ?? ""}
            placeholder="本章目标…"
            onBlur={(e) => {
              const n = e.target.value === "" ? null : Number(e.target.value);
              if (n !== chapter.target_words) void updateChapterMeta({ target_words: n });
            }}
            className={`${INPUT} w-28`}
          />
          <span className="text-xs text-[color:var(--text-faint)]">
            已写 {chapter.word_count} 字{progress != null ? ` · ${progress}%` : ""}
          </span>
        </div>
        {progress != null && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
            <div
              className="h-full rounded-full bg-[color:var(--accent)] transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* 关键词：章内已挂 chips + 词库补挂/新建（Enter） */}
      <div className="border-b border-[color:var(--border-subtle)] p-3">
        <SectionTitle>关键词</SectionTitle>
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {chapterKeywords.length === 0 && (
            <span className="text-xs text-[color:var(--text-faint)]">尚未挂关键词</span>
          )}
          {chapterKeywords.map((k) => (
            <span
              key={k.id}
              className="flex h-6 items-center gap-1 rounded-full px-2 text-xs"
              style={{ backgroundColor: `${k.color}26`, color: k.color }}
            >
              {k.title}
              <button
                onClick={() => void toggleChapterKeyword(k.id)}
                title="摘除"
                className="rounded-full p-0.5 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
              >
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
        <input
          value={kwDraft}
          list="meta-kw-options"
          placeholder="输入或选词，回车挂上…"
          onChange={(e) => setKwDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submitKeyword();
            }
          }}
          className={INPUT}
        />
        <datalist id="meta-kw-options">
          {keywords.map((k) => (
            <option key={k.id} value={k.title} />
          ))}
        </datalist>
      </div>

      {/* 自定义字段（M7 批次7）：按书定义四型字段，值挂当前章 */}
      {customDefs.length > 0 && (
        <div className="border-b border-[color:var(--border-subtle)] p-3" data-testid="custom-fields">
          <SectionTitle>自定义字段</SectionTitle>
          <div className="space-y-1.5">
            {customDefs.map((d) => {
              const key = String(d.id);
              const raw = customValues[key];
              if (d.field_type === "checkbox") {
                return (
                  <label key={d.id} className="flex cursor-pointer items-center gap-1.5 text-xs text-[color:var(--text-secondary)]">
                    <input
                      type="checkbox"
                      checked={raw === true}
                      onChange={(e) => void setCustomValue(d.id, e.target.checked)}
                      data-testid={`custom-value-${d.id}`}
                    />
                    {d.name}
                  </label>
                );
              }
              if (d.field_type === "list") {
                const options = optionsOf(d);
                return (
                  <div key={d.id} className="flex items-center gap-1.5 text-xs">
                    <span className="shrink-0 text-[color:var(--text-faint)]">{d.name}</span>
                    <select
                      key={`${chapter.id}-${key}-${raw == null ? "" : raw}`}
                      value={raw == null ? "" : String(raw)}
                      onChange={(e) => void setCustomValue(d.id, e.target.value === "" ? null : e.target.value)}
                      data-testid={`custom-value-${d.id}`}
                      className={`${INPUT} min-w-0 flex-1`}
                    >
                      <option value="">未设置</option>
                      {options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              return (
                <div key={d.id} className="flex items-center gap-1.5 text-xs">
                  <span className="shrink-0 text-[color:var(--text-faint)]">{d.name}</span>
                  <input
                    key={`${chapter.id}-${key}-${raw == null ? "" : raw}`}
                    type={d.field_type === "date" ? "date" : "text"}
                    defaultValue={raw == null ? "" : String(raw)}
                    placeholder={d.field_type === "date" ? "" : "填写…"}
                    onBlur={(e) => {
                      const v = e.target.value;
                      void setCustomValue(d.id, v === "" ? null : v);
                    }}
                    data-testid={`custom-value-${d.id}`}
                    className={`${INPUT} min-w-0 flex-1`}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 定义管理（内联展开） */}
      <div className="p-3">
        <button
          onClick={() => setManageOpen((v) => !v)}
          className="flex items-center gap-1 text-xs text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--text-secondary)]"
        >
          <Settings2 size={12} />
          管理定义
          {manageOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {manageOpen && (
          <div className="mt-2 space-y-3 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-2">
            {/* 标签定义：改色即时存，改名失焦存 */}
            <div>
              <div className="mb-1 text-xs text-[color:var(--text-faint)]">标签</div>
              <div className="space-y-1">
                {labels.map((l) => (
                  <div key={l.id} className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={l.color}
                      onChange={(e) => void labelUpsert({ id: l.id, book_id: l.book_id, title: l.title, color: e.target.value })}
                      className="h-5 w-5 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                    />
                    <input
                      defaultValue={l.title}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        if (t && t !== l.title) void labelUpsert({ id: l.id, book_id: l.book_id, title: t, color: l.color });
                      }}
                      className={`${INPUT} min-w-0 flex-1`}
                    />
                    <button
                      onClick={() => void labelDelete(l.id)}
                      title="删除标签（章上引用将置空）"
                      className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  value={newLabel}
                  placeholder="新标签名…"
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && newLabel.trim()) {
                      void labelUpsert({ id: null, book_id: currentBookId, title: newLabel.trim(), color: "#94a3b8" });
                      setNewLabel("");
                    }
                  }}
                  className={`${INPUT} min-w-0 flex-1`}
                />
                <button
                  onClick={() => {
                    if (newLabel.trim()) {
                      void labelUpsert({ id: null, book_id: currentBookId, title: newLabel.trim(), color: "#94a3b8" });
                      setNewLabel("");
                    }
                  }}
                  title="新增标签"
                  className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            {/* 状态定义 */}
            <div>
              <div className="mb-1 text-xs text-[color:var(--text-faint)]">状态</div>
              <div className="space-y-1">
                {statuses.map((st) => (
                  <div key={st.id} className="flex items-center gap-1.5">
                    <input
                      defaultValue={st.title}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        if (t && t !== st.title) void statusUpsert({ id: st.id, book_id: st.book_id, title: t });
                      }}
                      className={`${INPUT} min-w-0 flex-1`}
                    />
                    <button
                      onClick={() => void statusDelete(st.id)}
                      title="删除状态（章上引用将置空）"
                      className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  value={newStatus}
                  placeholder="新状态名…"
                  onChange={(e) => setNewStatus(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && newStatus.trim()) {
                      void statusUpsert({ id: null, book_id: currentBookId, title: newStatus.trim() });
                      setNewStatus("");
                    }
                  }}
                  className={`${INPUT} min-w-0 flex-1`}
                />
                <button
                  onClick={() => {
                    if (newStatus.trim()) {
                      void statusUpsert({ id: null, book_id: currentBookId, title: newStatus.trim() });
                      setNewStatus("");
                    }
                  }}
                  title="新增状态"
                  className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            {/* 关键词库 */}
            <div>
              <div className="mb-1 text-xs text-[color:var(--text-faint)]">关键词库</div>
              <div className="flex flex-wrap gap-1">
                {keywords.length === 0 && (
                  <span className="text-xs text-[color:var(--text-faint)]">在上方输入框回车即建档</span>
                )}
                {keywords.map((k) => (
                  <span
                    key={k.id}
                    className="flex h-6 items-center gap-1 rounded-full px-2 text-xs"
                    style={{ backgroundColor: `${k.color}26`, color: k.color }}
                  >
                    {k.title}
                    <button
                      onClick={() => void deleteKeyword(k.id)}
                      title="删除（章上引用一并清除）"
                      className="rounded-full p-0.5 transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            {/* 自定义字段定义（M7 批次7）：类型建档后不改 */}
            <div data-testid="custom-defs-manage">
              <div className="mb-1 text-xs text-[color:var(--text-faint)]">自定义字段</div>
              <div className="space-y-1">
                {customDefs.map((d) => (
                  <div key={d.id} className="flex items-center gap-1.5">
                    <span className="shrink-0 rounded px-1 py-0.5 text-[10px] text-[color:var(--text-secondary)]" style={{ backgroundColor: "var(--bg-panel)" }}>
                      {FIELD_TYPE_LABEL[d.field_type]}
                    </span>
                    <input
                      defaultValue={d.name}
                      onBlur={(e) => {
                        const t = e.target.value.trim();
                        if (t && t !== d.name) void customDefUpsert({ id: d.id, name: t, field_type: d.field_type, list_options: d.list_options });
                      }}
                      className={`${INPUT} min-w-0 flex-1`}
                    />
                    {d.field_type === "list" && (
                      <input
                        key={`opts-${d.id}-${d.list_options}`}
                        defaultValue={optionsOf(d).join("，")}
                        placeholder="选项，逗号分隔"
                        title="选项（逗号分隔）"
                        onBlur={(e) => {
                          const opts = JSON.stringify(e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean));
                          if (opts !== d.list_options) void customDefUpsert({ id: d.id, name: d.name, field_type: d.field_type, list_options: opts });
                        }}
                        className={`${INPUT} min-w-0 flex-1`}
                      />
                    )}
                    <button
                      onClick={() => void customDefDelete(d.id)}
                      title="删除字段（章上已填的值保留但不再显示）"
                      className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="mt-1 flex items-center gap-1.5">
                <input
                  value={newField}
                  placeholder="新字段名…"
                  onChange={(e) => setNewField(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) void submitNewField();
                  }}
                  className={`${INPUT} min-w-0 flex-1`}
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as CustomFieldDef["field_type"])}
                  aria-label="字段类型"
                  className={`${INPUT} w-16 shrink-0`}
                >
                  <option value="text">文本</option>
                  <option value="checkbox">勾选</option>
                  <option value="list">列表</option>
                  <option value="date">日期</option>
                </select>
                {newFieldType === "list" && (
                  <input
                    value={newFieldOptions}
                    placeholder="新字段的选项，逗号分隔"
                    onChange={(e) => setNewFieldOptions(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.nativeEvent.isComposing) void submitNewField();
                    }}
                    className={`${INPUT} min-w-0 flex-1`}
                  />
                )}
                <button
                  onClick={() => void submitNewField()}
                  title="新增字段"
                  className="shrink-0 rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
