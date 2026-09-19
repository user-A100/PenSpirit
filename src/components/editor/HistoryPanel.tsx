import { useEffect, useState } from "react";
import { diffLines, type Change } from "diff";
import { History, RotateCcw, X } from "lucide-react";
import { api, type SnapshotInfo } from "../../lib/tauri";

// M2-T7 章节版本历史侧滑面板：快照列表 + 与当前编辑器内容的按行 diff + 恢复此版本。
//
// 恢复流程（往返安全）：先把编辑器**实时**内容补存为一次快照（api.snapshotNow），
// 再 onRestore 覆盖编辑器 → 自动保存落盘。故「恢复」本身也可再恢复回来，
// 且自动保存防抖窗口内尚未落盘的输入不会丢。
//
// onRestore 约定为同步：只负责把文本灌进编辑器（不落盘），落盘交给既有的自动保存。

/** 拆行渲染：结尾换行不产生多余空行 */
function linesOf(value: string): string[] {
  const arr = value.split("\n");
  if (arr.length > 1 && arr[arr.length - 1] === "") arr.pop();
  return arr;
}

// 未改动段落超过该行数则折叠，避免整章正文铺满 DOM
const COLLAPSE_OVER = 6;

function Line(props: { text: string; kind: "add" | "del" | "same" }) {
  const tone =
    props.kind === "add"
      ? "bg-[color:var(--success)]/12 text-[color:var(--success)]"
      : props.kind === "del"
        ? "bg-[color:var(--danger)]/12 text-[color:var(--danger)]"
        : "text-[color:var(--text-secondary)]";
  return <div className={`whitespace-pre-wrap break-all px-2 ${tone}`}>{props.text || " "}</div>;
}

export function HistoryPanel(props: {
  chapterId: number;
  /** 读编辑器实时内容（每章一个实例，实时读避免拿到打开面板那一刻的旧值） */
  getCurrentContent: () => string;
  onRestore: (content: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<SnapshotInfo[]>([]);
  const [selected, setSelected] = useState<SnapshotInfo | null>(null);
  const [parts, setParts] = useState<Change[] | null>(null);
  const [confirmFile, setConfirmFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (chapterId: number) => {
    try {
      setItems(await api.listHistory(chapterId));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  useEffect(() => {
    setSelected(null);
    setParts(null);
    setConfirmFile(null);
    void load(props.chapterId);
  }, [props.chapterId]);

  const select = async (info: SnapshotInfo) => {
    try {
      const text = await api.readHistory(props.chapterId, info.file);
      setSelected(info);
      // 左为当前、右为该快照：added = 恢复后会出现的行，removed = 会消失的行
      setParts(diffLines(props.getCurrentContent(), text));
      setConfirmFile(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const restore = async (info: SnapshotInfo) => {
    try {
      const text = await api.readHistory(props.chapterId, info.file);
      await api.snapshotNow(props.chapterId, props.getCurrentContent());
      props.onRestore(text);
      setConfirmFile(null);
      await load(props.chapterId);
      setParts(diffLines(text, text)); // 已恢复到该版本，diff 归零
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const changed = parts?.some((p) => p.added || p.removed) ?? false;

  return (
    <div className="absolute right-0 top-0 z-40 flex h-full w-[380px] flex-col border-l border-[color:var(--border-strong)] bg-[var(--bg-elevated)] shadow-xl">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-[color:var(--border-subtle)] pl-3 pr-2">
        <History size={13} className="text-[color:var(--text-faint)]" />
        <span className="flex-1 text-xs font-medium text-[color:var(--text-primary)]">
          版本历史
          {items.length > 0 && <span className="ml-1 text-[color:var(--text-faint)]">({items.length})</span>}
        </span>
        <button
          onClick={props.onClose}
          title="关闭"
          className="rounded p-0.5 text-[color:var(--text-faint)] transition-colors duration-150 hover:text-[color:var(--text-primary)]"
        >
          <X size={13} />
        </button>
      </div>

      {error && <div className="px-3 py-2 text-[11px] text-[color:var(--danger)]">{error}</div>}

      {/* 快照列表（新→旧） */}
      <div className="max-h-56 shrink-0 overflow-y-auto border-b border-[color:var(--border-subtle)] p-1.5">
        {items.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-[color:var(--text-faint)]">还没有历史版本</div>
        ) : (
          items.map((s) => {
            const active = selected?.file === s.file;
            return (
              <div
                key={s.file}
                onClick={() => void select(s)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 ${
                  active
                    ? "bg-[var(--accent-dim)] text-[color:var(--text-primary)]"
                    : "text-[color:var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-xs">{s.ts}</span>
                <span className="shrink-0 text-[11px] text-[color:var(--text-faint)]">
                  {s.words.toLocaleString()} 字
                </span>
                {confirmFile === s.file ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void restore(s);
                    }}
                    title="确认恢复"
                    className="shrink-0 rounded bg-[color:var(--accent)]/15 px-1.5 py-0.5 text-[11px] text-[color:var(--accent-hover)] transition-colors duration-150 hover:bg-[color:var(--accent)]/25"
                  >
                    确认恢复
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmFile(s.file);
                    }}
                    title="恢复此版本"
                    className="shrink-0 rounded p-1 text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--accent-hover)]"
                  >
                    <RotateCcw size={12} />
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* diff 视图：当前 → 选中快照 */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-3 py-1.5 text-[11px] text-[color:var(--text-faint)]">
          {selected == null
            ? "选择上方一个版本查看与当前正文的差异"
            : changed
              ? "绿 = 恢复后新增的行，红 = 恢复后消失的行"
              : "与当前正文没有差异"}
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-3 font-mono text-[11px] leading-5">
          {parts?.map((p, i) => {
            const lines = linesOf(p.value);
            if (!p.added && !p.removed && lines.length > COLLAPSE_OVER) {
              return (
                <div key={i} className="px-2 py-0.5 text-[color:var(--text-faint)]">
                  …… 未改动 {lines.length} 行 ……
                </div>
              );
            }
            const kind = p.added ? "add" : p.removed ? "del" : "same";
            return lines.map((l, j) => <Line key={`${i}-${j}`} text={l} kind={kind} />);
          })}
        </div>
      </div>
    </div>
  );
}
