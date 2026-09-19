import { useEffect, useState } from "react";
import { Eraser, Plus, Shuffle, Sparkles, X } from "lucide-react";
import { useBump } from "../../stores/bump";
import { IdeaCardShelf } from "./IdeaCardShelf";
import { parseWords } from "./wordInput";

// M2-T10 碰碰车工作区（一级视图）：左侧词库 + 碰撞台，右侧灵感卡架。
// 词库来自 bump_words 表（迁移里预置了 10 个示例词，清空后不再自动恢复）。
// M3-T8：输入含分隔符时进入批量预览态，分词去重后一键入库。

export function BumpWorkspace() {
  const {
    words, drawn, count, note, tags, busy, error,
    load, addWord, addWords, removeWord, clearWords, draw, saveIdea, setCount, setNote, setTags,
  } = useBump();
  const [input, setInput] = useState("");
  /** 批量预览态的待加词（chip 可逐个移除，输入再变时整体重算） */
  const [pending, setPending] = useState<string[]>([]);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  const previewing = pending.length > 1;
  // chips 被移除到只剩 1 个时输入串里仍含分隔符，必须继续走批量路径，避免整串当一个词入库
  const batchMode = previewing || (pending.length === 1 && input.trim() !== pending[0]);
  const existingWords = new Set(words.map((w) => w.word));

  const syncInput = (v: string) => {
    setInput(v);
    setPending(parseWords(v));
  };

  const resetInput = () => {
    setInput("");
    setPending([]);
  };

  const submitWord = async () => {
    const w = input.trim();
    if (!w) return;
    await addWord(w);
    resetInput();
  };

  const addAll = async () => {
    if (pending.length === 0) return;
    await addWords(pending); // 词库已有的由 store 过滤
    resetInput();
  };

  return (
    <div className="flex h-full bg-[var(--bg-base)]">
      {/* 碰撞台 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] px-4">
          <Shuffle size={15} className="text-[color:var(--accent)]" />
          <span className="text-sm font-semibold text-[color:var(--text-primary)]">碰碰车</span>
          <span className="text-xs text-[color:var(--text-faint)]">把不相干的词撞在一起</span>
        </div>

        {error && <div className="px-4 py-2 text-xs text-[color:var(--danger)]">{error}</div>}

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {/* 词库 */}
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs text-[color:var(--text-secondary)]">词库</span>
            <span className="text-[11px] text-[color:var(--text-faint)]">{words.length} 个</span>
            {words.length > 0 &&
              (confirmClear ? (
                <button
                  onClick={() => {
                    void clearWords();
                    setConfirmClear(false);
                  }}
                  title="确认清空词库"
                  className="rounded px-1.5 py-0.5 text-[11px] text-[color:var(--danger)] transition-colors duration-150 hover:bg-[var(--bg-hover)]"
                >
                  确认清空
                </button>
              ) : (
                <button
                  onClick={() => setConfirmClear(true)}
                  title="清空词库"
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                >
                  <Eraser size={11} />
                  清空
                </button>
              ))}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {words.map((w) => (
              <span
                key={w.id}
                className="group flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2.5 pr-1.5 text-xs text-[color:var(--text-secondary)]"
              >
                {w.word}
                <button
                  onClick={() => void removeWord(w.id)}
                  title={`删除「${w.word}」`}
                  className="rounded-full p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <span className="flex items-center gap-1 rounded-md border border-transparent bg-[var(--bg-elevated)] py-0.5 pl-2 pr-1 transition-colors duration-150 focus-within:border-[color:var(--accent)]">
              <input
                value={input}
                onChange={(e) => syncInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (batchMode) void addAll();
                    else void submitWord();
                  } else if (e.key === "Escape" && previewing) {
                    resetInput();
                  }
                }}
                placeholder="加词，回车"
                className="w-20 bg-transparent text-xs text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
              />
              <button
                onClick={() => void (batchMode ? addAll() : submitWord())}
                title={batchMode ? "全部添加" : "加词"}
                className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--accent-hover)]"
              >
                <Plus size={12} />
              </button>
            </span>
          </div>

          {/* M3-T8 批量加词预览条 */}
          {previewing && (
            <div
              data-testid="batch-preview"
              className="mb-3 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--bg-panel)] px-3 py-2.5"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-medium text-[color:var(--text-secondary)]">
                  将添加 {pending.length} 个词
                </span>
                <button
                  onClick={() => void addAll()}
                  className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)]"
                >
                  全部添加
                </button>
                <span className="text-[11px] text-[color:var(--text-faint)]">Esc 取消</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {pending.map((w) => {
                  const exists = existingWords.has(w);
                  return (
                    <span
                      key={w}
                      className={`flex items-center gap-1 rounded-full border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] py-1 pl-2.5 pr-1.5 text-xs ${
                        exists
                          ? "text-[color:var(--text-faint)] line-through opacity-70"
                          : "text-[color:var(--text-secondary)]"
                      }`}
                    >
                      {w}
                      {exists && (
                        <span className="text-[10px] text-[color:var(--text-faint)]">已存在</span>
                      )}
                      <button
                        onClick={() => setPending(pending.filter((p) => p !== w))}
                        title={`移除「${w}」`}
                        className="rounded-full p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--danger)]"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {/* 抽取数量 + 碰撞 */}
          <div className="mb-5 flex items-center gap-3">
            <span className="text-xs text-[color:var(--text-secondary)]">抽取</span>
            <input
              type="range"
              min={2}
              max={4}
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="w-32 accent-[color:var(--accent)]"
            />
            <span className="w-8 text-xs text-[color:var(--text-faint)]">{count} 个</span>
            <button
              onClick={() => void draw()}
              disabled={busy || words.length < count}
              className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-40"
            >
              <Shuffle size={13} />
              {drawn.length > 0 ? "换一组" : "碰撞"}
            </button>
            {words.length < count && (
              <span className="text-[11px] text-[color:var(--text-faint)]">词库至少需要 {count} 个词</span>
            )}
          </div>

          {/* 碰撞结果大卡片 */}
          {drawn.length > 0 && (
            <div className="rounded-xl border border-[color:var(--border-strong)] bg-[var(--bg-panel)] p-6 text-center">
              <div className="text-2xl font-semibold tracking-wide text-[color:var(--text-primary)]">
                {drawn.join(" × ")}
              </div>
              <div className="mt-4 flex items-center justify-center gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="备注（可选）"
                  className="w-56 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]"
                />
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="标签，空格分隔"
                  className="w-40 rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] px-2.5 py-1.5 text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]"
                />
                <button
                  onClick={() => void saveIdea()}
                  className="flex items-center gap-1.5 rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                >
                  <Sparkles size={13} />
                  存为灵感卡
                </button>
              </div>
            </div>
          )}

          {drawn.length === 0 && words.length >= count && (
            <div className="rounded-xl border border-dashed border-[color:var(--border-subtle)] px-6 py-12 text-center text-xs text-[color:var(--text-faint)]">
              点「碰撞」抽一组词
            </div>
          )}
        </div>
      </div>

      {/* 灵感卡架 */}
      <div className="w-[320px] shrink-0 border-l border-[color:var(--border-subtle)] bg-[var(--bg-panel)]">
        <IdeaCardShelf />
      </div>
    </div>
  );
}
