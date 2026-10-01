import { create } from "zustand";

// 朗读（阶段 2C，听稿查语感）：系统语音合成（WebView 的 speechSynthesis；Windows 自带中文语音）。
// 按段切开逐段读——一次塞整章会被截断；新的朗读会打断上一段。

export const useSpeech = create<{ speaking: boolean; label: string }>(() => ({ speaking: false, label: "" }));

let queue: string[] = [];
let gen = 0;

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

function zhVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices();
  return voices.find((v) => /^zh[-_]?(cn|hans)/i.test(v.lang)) ?? voices.find((v) => v.lang.toLowerCase().startsWith("zh"));
}

export function speak(text: string, label = "朗读中"): boolean {
  if (!speechSupported()) return false;
  stopSpeaking();
  const paras = text
    .replace(/\r\n/g, "\n")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (paras.length === 0) return false;
  const my = ++gen;
  queue = paras;
  useSpeech.setState({ speaking: true, label });
  const next = () => {
    if (my !== gen) return;
    const p = queue.shift();
    if (p == null) {
      useSpeech.setState({ speaking: false, label: "" });
      return;
    }
    const u = new SpeechSynthesisUtterance(p);
    u.lang = "zh-CN";
    const v = zhVoice();
    if (v) u.voice = v;
    u.onend = next;
    u.onerror = next;
    window.speechSynthesis.speak(u);
  };
  next();
  return true;
}

export function stopSpeaking(): void {
  gen++;
  queue = [];
  if (speechSupported()) window.speechSynthesis.cancel();
  useSpeech.setState({ speaking: false, label: "" });
}
