import { initials } from "../pinyin";

// 斜杠命令（阶段 2A）：一处定义——名字（中文）、拼音首字母别名、模板、模式、默认产出方式、
// 本命令默认关闭的上下文槽位。选中命令只把模板放进输入框（可补充后再发），
// 标了 sendNow 的无参数命令选中即发；local 命令在本地执行（不调模型）。

export type CommandOutput = "insert" | "replace" | "chat";

export interface SlashCommand {
  id: string;
  name: string;
  desc: string;
  template: string;
  mode: "write" | "discuss";
  /** 需要编辑器选区（扩写/润色等）：无选区时提示先选中 */
  needsSelection?: boolean;
  /** 采纳主按钮：插入光标 / 替换选区 / 仅对话 */
  output: CommandOutput;
  /** 默认长度预设 */
  targetChars?: number;
  /** 本命令默认关闭的槽位 */
  disable?: string[];
  /** 选中即发 */
  sendNow?: boolean;
  /** 本地命令 */
  local?: "newSession" | "context" | "help";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "continue", name: "续写", desc: "从光标处接着往下写", template: "接着光标处往下写，保持人称与节奏。", mode: "write", output: "insert", targetChars: 800 },
  { id: "scene", name: "写场景", desc: "用一句话的节拍写一场戏", template: "写一场戏：", mode: "write", output: "insert", targetChars: 1500 },
  { id: "expand", name: "扩写", desc: "选中段落写长，补细节不改情节", template: "把选中段落扩写到约两倍，补充动作、神态、环境与心理细节，不改变情节走向与人称。", mode: "write", needsSelection: true, output: "replace" },
  { id: "condense", name: "缩写", desc: "选中段落压缩一半，去水分", template: "把选中段落压缩到约一半，保留关键情节、对白与转折，删去重复与冗词。", mode: "write", needsSelection: true, output: "replace" },
  { id: "polish", name: "润色", desc: "语句通顺、去 AI 腔，不改情节", template: "润色选中段落：语句通顺自然，去掉 AI 腔与陈词滥调，不改情节、人称与关键信息。", mode: "write", needsSelection: true, output: "replace" },
  { id: "rewrite", name: "改写", desc: "按你的要求改写选中段落", template: "改写选中段落：", mode: "write", needsSelection: true, output: "replace" },
  { id: "describe", name: "描写", desc: "补一段环境/外貌/打斗/氛围描写", template: "在光标处补一段描写：", mode: "write", output: "insert", targetChars: 300 },
  { id: "dialogue", name: "对话", desc: "写一段符合人物性格的对白", template: "写一段对话：", mode: "write", output: "insert", targetChars: 600 },
  { id: "bridge", name: "插写", desc: "在光标处补一段过渡，接上前后文", template: "在光标处插写一段过渡：承接光标前文，自然引出光标后文，不重复前后已有内容。", mode: "write", output: "insert", targetChars: 400 },
  { id: "directions", name: "走向", desc: "先给 3 条走向，点一条再写", template: "接下来怎么写？先给我 3 条明显不同的走向，每条一两句话，用 1. 2. 3. 编号，只写走向，不写正文。", mode: "discuss", output: "chat", sendNow: true, disable: ["光标后文"] },
  { id: "compact", name: "压缩", desc: "把此前对话压成摘要，之后只带摘要", template: "把我们到目前为止的讨论压缩成一份要点摘要：已确定的设定与剧情决定、人物状态、待解决的问题。条目式，300 字以内。之后的对话会用这份摘要代替前面的全部内容。", mode: "discuss", output: "chat", sendNow: true },
  { id: "continue-reply", name: "继续", desc: "接着上一条回答往下写", template: "接着你上一条回答继续写，不要重复已写内容。", mode: "write", output: "insert", sendNow: true },
  { id: "brainstorm", name: "头脑风暴", desc: "下一步剧情的多个方向", template: "接下来剧情可以怎么走？给我 5 个明显不同的方向，每个一两句话，点明冲突、转折与爽点。", mode: "discuss", output: "chat", disable: ["光标后文"] },
  { id: "names", name: "起名", desc: "人名/地名/门派/功法", template: "帮我起名：", mode: "discuss", output: "chat" },
  { id: "summary", name: "总结本章", desc: "200 字内总结人物、事件、悬念", template: "用 200 字以内总结本章：出场人物、发生了什么、留下了哪些悬念。", mode: "discuss", output: "chat", sendNow: true },
  { id: "check", name: "检查设定", desc: "找出与设定/前文矛盾之处", template: "检查本章与人物设定、前文是否有矛盾或不合理之处，逐条列出，引用原句并给出修改建议。", mode: "discuss", output: "chat", sendNow: true },
  { id: "new-session", name: "新对话", desc: "开一个新会话", template: "", mode: "discuss", output: "chat", local: "newSession" },
  { id: "context", name: "上下文", desc: "查看本轮注入了什么", template: "", mode: "discuss", output: "chat", local: "context" },
  { id: "help", name: "帮助", desc: "命令与快捷键一览", template: "", mode: "discuss", output: "chat", local: "help" },
];

export function findCommand(id: string | null | undefined): SlashCommand | undefined {
  return id ? SLASH_COMMANDS.find((c) => c.id === id) : undefined;
}

/** 按输入过滤命令：中文名包含 / 拼音首字母前缀 / 拼音首字母包含 */
export function matchCommands(query: string): SlashCommand[] {
  const q = query.trim().toLowerCase();
  if (q === "") return SLASH_COMMANDS;
  const scored: Array<{ c: SlashCommand; s: number }> = [];
  for (const c of SLASH_COMMANDS) {
    const ini = initials(c.name);
    let s = -1;
    if (c.name.startsWith(q)) s = 100;
    else if (c.name.includes(q)) s = 80;
    else if (ini.startsWith(q)) s = 70;
    else if (ini.includes(q)) s = 50;
    else if (c.desc.includes(q)) s = 20;
    if (s >= 0) scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}
