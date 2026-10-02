import { Square, Volume2 } from "lucide-react";
import { stopSpeaking, useSpeech } from "../../lib/speech";

// 朗读中的浮动条（阶段 2C）：一眼看到在读、一键停。
export function SpeechChip() {
  const speaking = useSpeech((s) => s.speaking);
  const label = useSpeech((s) => s.label);
  if (!speaking) return null;
  return (
    <div data-testid="speech-chip" className="menu-pop fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color:var(--hairline)] bg-[var(--bg-elevated)] py-1 pl-3 pr-1 text-xs text-[color:var(--text-secondary)] [box-shadow:var(--shadow-overlay)]">
      <Volume2 size={13} className="text-[color:var(--accent)]" />
      <span>{label}</span>
      <button onClick={stopSpeaking} aria-label="停止朗读" className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[color:var(--danger)] hover:bg-[var(--fill-hover)]">
        <Square size={10} /> 停止
      </button>
    </div>
  );
}
