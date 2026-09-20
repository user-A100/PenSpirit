import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { FileUp, ScanSearch } from "lucide-react";
import { api, type SensitiveHit } from "../../lib/tauri";
import { Modal } from "../ui/Modal";

// M2-T11 敏感词检测：手动检查当前章 + 词库管理（一行一词 / 从 txt 导入）。
// 只报告，不改正文——是否修改由作者判断。

export function SensitiveDialog(props: { content: string; onClose: () => void }) {
  const [hits, setHits] = useState<SensitiveHit[] | null>(null);
  const [bank, setBank] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .sensitiveGetWords()
      .then((w) => setBank(w.join("\n")))
      .catch((e) => setError(String(e)));
  }, []);

  const wordCount = bank.split("\n").filter((l) => l.trim() !== "").length;

  const scan = async () => {
    setBusy(true);
    try {
      setHits(await api.sensitiveScan(props.content));
      setNote(null);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveBank = async () => {
    try {
      const saved = await api.sensitiveSetWords(bank.split("\n"));
      setBank(saved.join("\n"));
      setDirty(false);
      setNote(`词库已保存（${saved.length} 个词）`);
      setError(null);
      // 词库变了，已有检查结果作废
      setHits(null);
    } catch (e) {
      setError(String(e));
    }
  };

  const importTxt = async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "文本", extensions: ["txt"] }],
      });
      if (typeof path !== "string") return;
      const imported = await api.sensitiveImportWords(path);
      const merged = [...new Set([...bank.split("\n").map((l) => l.trim()), ...imported])].filter(
        Boolean,
      );
      setBank(merged.join("\n"));
      setDirty(true);
      setNote(`从文件读入 ${imported.length} 个词，点「保存词库」后生效`);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <Modal
      open
      onClose={props.onClose}
      title="敏感词检查"
      widthClass="max-w-lg"
      testId="sensitive-backdrop"
    >
        <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--border-subtle)] px-4 py-3">
          <button
            onClick={() => void scan()}
            disabled={busy || wordCount === 0}
            className="flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition-colors duration-150 hover:bg-[var(--accent-hover)] disabled:opacity-40"
          >
            <ScanSearch size={13} />
            {busy ? "检查中…" : "检查本章"}
          </button>
          <span className="text-[11px] text-[color:var(--text-faint)]">
            {wordCount === 0 ? "词库为空，先在下方添加词" : `词库 ${wordCount} 个词`}
          </span>
          {hits != null && (
            <span className="ml-auto text-[11px] text-[color:var(--text-faint)]">
              {hits.length === 0 ? "未发现敏感词" : `命中 ${hits.length} 处`}
            </span>
          )}
        </div>

        {error && <div className="px-4 py-2 text-xs text-[color:var(--danger)]">{error}</div>}
        {note && <div className="px-4 py-2 text-xs text-[color:var(--success)]">{note}</div>}

        {/* 检查结果 */}
        {hits != null && hits.length > 0 && (
          <div className="max-h-48 shrink-0 overflow-y-auto border-b border-[color:var(--border-subtle)] px-4 py-2">
            {hits.map((h, i) => (
              <div key={i} className="flex items-baseline gap-2 py-1">
                <span className="shrink-0 rounded bg-[color:var(--danger)]/15 px-1.5 py-0.5 text-[11px] text-[color:var(--danger)]">
                  {h.word}
                </span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-[color:var(--text-secondary)]" title={h.context}>
                  …{h.context}…
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 词库 */}
        <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs text-[color:var(--text-secondary)]">词库（一行一词）</span>
            <button
              onClick={() => void importTxt()}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[color:var(--text-faint)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
            >
              <FileUp size={11} />
              从 txt 导入
            </button>
            {dirty && (
              <button
                onClick={() => void saveBank()}
                className="rounded bg-[var(--accent)]/15 px-2 py-0.5 text-[11px] text-[color:var(--accent-hover)] transition-colors duration-150 hover:bg-[var(--accent)]/25"
              >
                保存词库
              </button>
            )}
          </div>
          <textarea
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setDirty(true);
            }}
            placeholder={"一行一个词\n# 以 # 开头的行会被忽略"}
            spellCheck={false}
            className="min-h-32 flex-1 resize-none rounded-md border border-[color:var(--border-subtle)] bg-[var(--bg-elevated)] p-2 font-mono text-xs text-[color:var(--text-primary)] outline-none transition-colors duration-150 placeholder:text-[color:var(--text-faint)] focus:border-[color:var(--accent)]"
          />
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-[color:var(--border-subtle)] px-4 py-3">
          <span className="mr-auto self-center text-[11px] text-[color:var(--text-faint)]">
            检查不会改动正文
          </span>
          <button
            onClick={props.onClose}
            className="rounded-md border border-[color:var(--border-subtle)] px-3 py-1.5 text-xs text-[color:var(--text-secondary)] transition-colors duration-150 hover:bg-[var(--bg-hover)] hover:text-[color:var(--text-primary)]"
          >
            全部忽略
          </button>
        </div>
    </Modal>
  );
}
