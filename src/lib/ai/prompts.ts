import { create } from "zustand";
import { kvGet, kvSet } from "../kv";
import type { CommandOutput, SlashCommand } from "./slashCommands";

// 自定义命令库（阶段 2B，Sudowrite Plugins / Cursor 自定义命令 / NovelAI 预设移植）：
// 作者把常用的提示词存成命令——名字（输入框 / 里叫它）、模板（可带变量）、写正文 / 讨论、
// 产出方式（插入 / 替换选区 / 仅对话）、绑定的模型与温度、是否进选区气泡。
// 全书通用（换书照样用），存 settings KV「ai_prompts」。
// 变量：{{选区}} {{章名}} {{书名}} {{光标前文}} 运行时自动填；其它 {{名字}} 运行时弹一个小表单问。

export interface PromptTemplate {
  id: string;
  name: string;
  desc: string;
  template: string;
  mode: "write" | "discuss";
  output: CommandOutput;
  /** 绑定温度（null = 跟随输入区设置） */
  temperature: number | null;
  /** 长度预设（null = 跟随输入区设置） */
  targetChars: number | null;
  /** 绑定的服务商（null = 跟随「使用中」） */
  providerId: number | null;
  /** 选中即发（否则放进输入框可补充） */
  sendNow: boolean;
  /** 出现在正文选区气泡里 */
  inBubble: boolean;
}

export const PROMPTS_KEY = "ai_prompts";
export const AUTO_VARS = ["选区", "章名", "书名", "光标前文"];
const VAR_RE = /\{\{\s*([^{}\n]+?)\s*\}\}/g;

/** 模板里出现的变量名（去重、保序） */
export function templateVars(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(VAR_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function fillTemplate(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (_, name: string) => values[name.trim()] ?? "");
}

export function blankPrompt(): PromptTemplate {
  return {
    id: `p${Date.now().toString(36)}`,
    name: "",
    desc: "",
    template: "",
    mode: "write",
    output: "insert",
    temperature: null,
    targetChars: null,
    providerId: null,
    sendNow: false,
    inBubble: false,
  };
}

/** 自定义命令 → 斜杠命令（id 带 custom: 前缀，与内置的区分） */
export function toSlash(t: PromptTemplate): SlashCommand {
  const vars = templateVars(t.template);
  return {
    id: `custom:${t.id}`,
    name: t.name,
    desc: t.desc || "自定义命令",
    template: t.template,
    mode: t.mode,
    output: t.output,
    needsSelection: vars.includes("选区") || t.output === "replace",
    targetChars: t.targetChars ?? undefined,
    sendNow: t.sendNow,
    // 选区已经直接填进指令：不再另作「选中段落」重复注入
    disable: vars.includes("选区") ? ["选中段落"] : undefined,
    custom: true,
    temperature: t.temperature,
    providerId: t.providerId,
  };
}

interface PromptsState {
  list: PromptTemplate[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (t: PromptTemplate) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const usePrompts = create<PromptsState>((set, get) => ({
  list: [],
  loaded: false,
  load: async () => {
    try {
      const v = await kvGet<PromptTemplate[]>(PROMPTS_KEY);
      set({ list: Array.isArray(v) ? v.filter((x) => x && typeof x.id === "string") : [], loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
  save: async (t) => {
    const cur = get().list;
    const list = cur.some((x) => x.id === t.id) ? cur.map((x) => (x.id === t.id ? t : x)) : [...cur, t];
    set({ list });
    await kvSet(PROMPTS_KEY, list);
  },
  remove: async (id) => {
    const list = get().list.filter((x) => x.id !== id);
    set({ list });
    await kvSet(PROMPTS_KEY, list);
  },
}));
