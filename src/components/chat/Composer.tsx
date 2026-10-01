import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, BookOpen, Clock, Flag, Blocks, ListTree, Package, Paperclip, Quote, SendHorizontal, Slash, Square, Users, X } from "lucide-react";
import { pickOpenPath } from "../../lib/dialogs";
import { useCtxPresets, type CtxPreset } from "../../lib/ai/ctxPresets";
import { promptDialog } from "../../stores/confirm";
import { errMsg } from "../../lib/errors";
import { buildTurnOptions, useChat, type MentionItem } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";
import { api, type AssemblyLog, type MentionRef, type WritingRule } from "../../lib/tauri";
import { StyleSwitch } from "./StyleSwitch";
import { findCommand, matchCommands, type SlashCommand } from "../../lib/ai/slashCommands";
import { fillCommand } from "../../lib/ai/runPrompt";
import { fuzzyMatch } from "../../lib/pinyin";
import { quoteSelection } from "../../lib/ai/actions";
import { openMenuAt } from "../../stores/menu";
import { toast } from "../../stores/toast";

// 输入区（阶段 2A）：上下文胶囊（点一下本轮关闭/打开）+ 引用选区 + @ 引用 + 斜杠命令 +
// 长度/温度预设 + token 估算 + 发送/停止。草稿按章节保存；空输入按 ↑ 召回上一条。

const DRAFT_PREFIX = "bixian.chat.draft.";
const LENGTHS: Array<number | null> = [null, 300, 800, 2000];
const TEMPS: Array<{ label: string; value: number | null }> = [
  { label: "默认温度（随服务商）", value: null },
  { label: "稳：0.3（润色/检查）", value: 0.3 },
  { label: "均衡：0.7", value: 0.7 },
  { label: "放飞：1.1（脑暴/描写）", value: 1.1 },
];
/** 胶囊里展示的槽位（System/写作指令不展示） */
const PILL_SLOTS = ["文风", "常驻记忆", "写作规则", "用词要求", "作者批注", "角色卡", "伏笔提醒", "情节块", "灵感卡", "引用资料", "上一章结尾", "对话历史", "光标前文", "当前章正文", "光标后文", "选中段落", "附件", "作者注"];
const KIND_LABEL: Record<MentionRef["kind"], string> = { chapter: "章节", character: "人物", foreshadow: "伏笔", plot: "情节块", outline: "大纲" };
const KIND_ICON = { chapter: BookOpen, character: Users, foreshadow: Flag, plot: Blocks, outline: ListTree } as const;

function saveDraft(chapterId: number, text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + chapterId, text);
    else localStorage.removeItem(DRAFT_PREFIX + chapterId);
  } catch {
    // 忽略
  }
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

type MenuState = { kind: "slash" | "mention"; query: string; index: number } | null;

export function Composer({ onLocal }: { onLocal: (kind: "context" | "help" | "prompts") => void }) {
  const chapterId = useWorkspace((s) => s.currentChapterId);
  const bookId = useWorkspace((s) => s.currentBookId);
  const chapters = useWorkspace((s) => s.chapters);
  const sessionId = useChat((s) => s.sessionId);
  const streaming = useChat((s) => s.streaming);
  const queue = useChat((s) => s.queue);
  const messages = useChat((s) => s.messages);
  const mode = useChat((s) => s.mode);
  const targetChars = useChat((s) => s.targetChars);
  const temperature = useChat((s) => s.temperature);
  const disabledSlots = useChat((s) => s.disabledSlots);
  const pickedRules = useChat((s) => s.manualRules);
  const previewSeq = useChat((s) => s.previewSeq);
  const toggleRule = useChat((s) => s.toggleRule);
  const candidates = useChat((s) => s.candidates);
  const setCandidates = useChat((s) => s.setCandidates);
  const [manualRules, setManualRules] = useState<WritingRule[]>([]);
  const mentions = useChat((s) => s.mentions);
  const quote = useChat((s) => s.quote);
  const attachments = useChat((s) => s.attachments);
  const preset = useCtxPresets((s) => s.active);
  // 阶段 2C：附件（txt / md / docx）
  const attach = async () => {
    const path = await pickOpenPath({ filters: [{ name: "文本 / Word", extensions: ["txt", "md", "docx"] }] });
    if (!path) return;
    try {
      const r = await api.attachmentRead(path);
      useChat.getState().addAttachment({ name: r.name, text: r.text });
      if (r.truncated) toast.info(`「${r.name}」有 ${r.chars.toLocaleString()} 字，只取了前 ${r.text.length.toLocaleString()} 字`);
    } catch (e) {
      toast.error(`读附件失败：${errMsg(e)}`);
    }
  };
  // 阶段 2C：上下文包（常驻；与本轮临时设置合并）
  const presetMenu = (el: Element) => {
    const ps = useCtxPresets.getState();
    const st = useChat.getState();
    openMenuAt(el, [
      { type: "label", label: "上下文包（选中后每轮都带上）" },
      ...ps.list.map((p) => ({ label: p.name, checked: ps.active?.id === p.id, onSelect: () => applyPreset(ps.active?.id === p.id ? null : p) })),
      ...(ps.list.length === 0 ? [{ label: "还没有上下文包", disabled: true }] : []),
      { type: "separator" },
      {
        label: "把当前设置存为上下文包…",
        onSelect: async () => {
          if (st.mentions.length === 0 && st.disabledSlots.length === 0 && st.manualRules.length === 0) {
            toast.info("先 @ 引用一些设定、或在胶囊上关掉不要的槽位，再存成上下文包");
            return;
          }
          const name = await promptDialog({ title: "存为上下文包", placeholder: "如：第三卷战斗戏", confirmLabel: "保存" });
          if (!name) return;
          const p: CtxPreset = {
            id: `c${Date.now().toString(36)}`,
            name,
            mentions: st.mentions,
            disabledSlots: st.disabledSlots,
            rules: st.manualRules,
            mode: st.mode,
            targetChars: st.targetChars,
            temperature: st.temperature,
          };
          await useCtxPresets.getState().save(p);
          applyPreset(p);
          toast.success(`已存为上下文包「${name}」并启用`);
        },
      },
      ...(ps.list.length > 0
        ? [{ label: "删除上下文包", submenu: ps.list.map((p) => ({ label: p.name, danger: true, onSelect: () => void useCtxPresets.getState().remove(p.id) })) }]
        : []),
    ]);
  };
  const applyPreset = (p: CtxPreset | null) => {
    useCtxPresets.getState().setActive(p);
    if (!p) return;
    const st = useChat.getState();
    if (p.mode) st.setMode(p.mode);
    st.setTargetChars(p.targetChars);
    st.setTemperature(p.temperature);
  };
  const compose = useChat((s) => s.compose);
  const { send, stop, toggleSlot, addMention, removeMention, setQuote, setTargetChars, setTemperature, newSession } = useChat.getState();

  const [text, setText] = useState("");
  const [command, setCommand] = useState<SlashCommand | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [log, setLog] = useState<AssemblyLog | null>(null);
  const [pool, setPool] = useState<MentionItem[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const poolBook = useRef<number | null>(null);
  const textRef = useRef(text);
  textRef.current = text;
  const prevChapter = useRef<number | null>(null);

  // 草稿：换章先把上一章草稿立即落盘（防抖窗口内切章也不丢），再读回本章草稿
  useEffect(() => {
    const prev = prevChapter.current;
    if (prev != null && prev !== chapterId) saveDraft(prev, textRef.current);
    prevChapter.current = chapterId;
    if (chapterId == null) return;
    let draft = "";
    try {
      draft = localStorage.getItem(DRAFT_PREFIX + chapterId) ?? "";
    } catch {
      // 忽略
    }
    setText(draft);
    setCommand(null);
    setMenu(null);
  }, [chapterId]);
  useEffect(() => {
    if (chapterId == null) return;
    const h = window.setTimeout(() => saveDraft(chapterId, text), 300);
    return () => window.clearTimeout(h);
  }, [text, chapterId]);
  // 卸载（收起 AI 卡）时冲刷
  useEffect(
    () => () => {
      if (prevChapter.current != null) saveDraft(prevChapter.current, textRef.current);
    },
    [],
  );

  // 外部预填（气泡菜单「改写…」/ Ctrl+L）
  useEffect(() => {
    if (!compose) return;
    if (compose.text) setText(compose.text);
    setCommand(findCommand(compose.command) ?? null);
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  }, [compose]);

  // 上下文胶囊：防抖向后端要一份本轮组装日志（与发送同一路径，所见即所发）
  useEffect(() => {
    if (sessionId == null || streaming) return;
    let cancelled = false;
    const h = window.setTimeout(() => {
      const opts = buildTurnOptions({ command: command?.id ?? null, mode: command?.mode, disable: command?.disable });
      api
        .previewContext(sessionId, text.trim() || command?.template || "（输入中）", opts)
        .then((l) => !cancelled && setLog(l))
        .catch(() => !cancelled && setLog(null));
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(h);
    };
  }, [sessionId, streaming, text, command, mode, targetChars, disabledSlots, mentions, quote, messages.length, pickedRules, previewSeq]);

  // 阶段 2B：手动选用的写作规则（记忆与规则面板里改了会触发 previewSeq 重取）
  useEffect(() => {
    if (bookId == null) return;
    let cancelled = false;
    api
      .rulesList(bookId)
      .then((rs) => !cancelled && setManualRules(rs.filter((r) => r.mode === "manual")))
      .catch(() => !cancelled && setManualRules([]));
    return () => {
      cancelled = true;
    };
  }, [bookId, previewSeq]);

  // @ 候选：首次打开菜单时按书拉取（章节直接用工作区列表）
  const loadPool = async () => {
    if (bookId == null || poolBook.current === bookId) return;
    poolBook.current = bookId;
    try {
      const [chars, fs, plots, outlines] = await Promise.all([
        api.charactersList(bookId),
        api.foreshadowsList(bookId),
        api.plotBlocksList(bookId),
        api.outlinesList(bookId),
      ]);
      setPool([
        ...chars.map((c) => ({ kind: "character" as const, id: c.id, label: c.name })),
        ...fs.map((f) => ({ kind: "foreshadow" as const, id: f.id, label: f.title })),
        ...plots.map((p) => ({ kind: "plot" as const, id: p.id, label: p.content.slice(0, 24) })),
        ...outlines.map((o) => ({ kind: "outline" as const, id: o.id, label: o.title || "（未命名大纲）" })),
      ]);
    } catch {
      poolBook.current = null;
    }
  };

  const slashItems = useMemo(() => (menu?.kind === "slash" ? matchCommands(menu.query) : []), [menu]);
  const mentionItems = useMemo(() => {
    if (menu?.kind !== "mention") return [];
    const all: MentionItem[] = [...chapters.map((c) => ({ kind: "chapter" as const, id: c.id, label: c.title })), ...pool];
    const scored = all
      .map((m) => ({ m, s: fuzzyMatch(menu.query, m.label)?.score ?? -1 }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s);
    return scored.slice(0, 12).map((x) => x.m);
  }, [menu, chapters, pool]);

  const updateMenu = (value: string, caret: number) => {
    if (!command && /^\/\S*$/.test(value)) {
      setMenu((m) => ({ kind: "slash", query: value.slice(1), index: m?.kind === "slash" ? m.index : 0 }));
      return;
    }
    const at = /@([^\s@]{0,20})$/.exec(value.slice(0, caret));
    if (at) {
      void loadPool();
      setMenu((m) => ({ kind: "mention", query: at[1], index: m?.kind === "mention" ? m.index : 0 }));
      return;
    }
    setMenu(null);
  };

  const pickCommand = (c: SlashCommand) => {
    setMenu(null);
    if (c.local) {
      setText("");
      if (c.local === "newSession") void newSession();
      else onLocal(c.local);
      return;
    }
    if (c.needsSelection && !useChat.getState().quote && !quoteSelection()) {
      toast.info(`「${c.name}」作用于选中段落：先在正文选中一段（或选好后按 Ctrl+L）`);
    }
    // 阶段 2B：自定义命令先填变量（{{选区}} 等自动、其它弹表单），再进输入框 / 直接发
    if (c.custom) {
      setText("");
      void fillCommand(c).then((filled) => {
        if (filled == null) return;
        setCommand(c);
        setText(filled);
        if (c.sendNow) void doSend(filled, c);
        else requestAnimationFrame(() => taRef.current?.focus());
      });
      return;
    }
    setCommand(c);
    setText(c.template);
    if (c.sendNow) {
      void doSend(c.template, c);
      return;
    }
    requestAnimationFrame(() => {
      const ta = taRef.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
  };

  const pickMention = (m: MentionItem) => {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,20})$/, "");
    setText(before + text.slice(caret));
    addMention(m);
    setMenu(null);
    requestAnimationFrame(() => ta?.focus());
  };

  async function doSend(raw = text, cmd: SlashCommand | null = command) {
    const t = raw.trim();
    if (!t && !cmd) return;
    if (chapterId == null) return;
    // 阶段 2C：生成中回车 = 排队，这一轮结束后自动发出
    if (streaming) {
      useChat.getState().enqueue(t || cmd?.template || "", cmd ? { command: cmd.id, mode: cmd.mode, targetChars: cmd.targetChars ?? targetChars, disable: cmd.disable, temperature: cmd.temperature, providerId: cmd.providerId } : {});
      setText("");
      setCommand(null);
      setMenu(null);
      return;
    }
    if (cmd?.needsSelection && !useChat.getState().quote && !quoteSelection()) {
      toast.error(`「${cmd.name}」需要先在正文中选中一段`);
      return;
    }
    const instruction = t || cmd?.template || "";
    setText("");
    setCommand(null);
    setMenu(null);
    const ok = await send(
      instruction,
      cmd ? { command: cmd.id, mode: cmd.mode, targetChars: cmd.targetChars ?? targetChars, disable: cmd.disable, temperature: cmd.temperature, providerId: cmd.providerId } : {},
    );
    if (!ok) {
      setText(t);
      setCommand(cmd);
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (menu) {
      const n = menu.kind === "slash" ? slashItems.length : mentionItems.length;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (n === 0) return;
        const d = e.key === "ArrowDown" ? 1 : -1;
        setMenu({ ...menu, index: (menu.index + d + n) % n });
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && n > 0) {
        e.preventDefault();
        if (menu.kind === "slash") pickCommand(slashItems[menu.index]);
        else pickMention(mentionItems[menu.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMenu(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void doSend();
      return;
    }
    if (e.key === "ArrowUp" && text === "" && !command) {
      const last = [...messages].reverse().find((m) => m.role === "user" && m.id > 0);
      if (last) {
        e.preventDefault();
        setText(last.content);
      }
      return;
    }
    if (e.key === "Backspace" && text === "" && command) {
      e.preventDefault();
      setCommand(null);
      return;
    }
    if (e.key === "Escape" && command) {
      e.preventDefault();
      setCommand(null);
      setText("");
    }
  };

  const pills = (log?.slots ?? []).filter((s) => PILL_SLOTS.includes(s.name));
  const totalTokens = log?.total_est_tokens ?? 0;
  const budget = log?.budget_tokens ?? 0;
  const trimmedCount = (log?.slots ?? []).filter((s) => s.trimmed).length;
  const disabled = chapterId == null;

  return (
    <div className="relative shrink-0 px-3 pb-3">
      {/* 斜杠 / @ 菜单（浮在输入框上方） */}
      {menu && (menu.kind === "slash" ? slashItems.length > 0 : true) && (
        <div role="listbox" aria-label={menu.kind === "slash" ? "命令" : "引用"} className="menu-pop absolute bottom-full left-3 right-3 z-30 mb-1 max-h-72 overflow-y-auto rounded-[var(--r-control)] border border-[color:var(--hairline)] bg-[var(--bg-elevated)] p-1 [box-shadow:var(--shadow-overlay)]">
          {menu.kind === "slash"
            ? slashItems.map((c, i) => (
                <div
                  key={c.id}
                  role="option"
                  aria-selected={i === menu.index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickCommand(c);
                  }}
                  onMouseMove={() => setMenu({ ...menu, index: i })}
                  className={`flex cursor-default items-center gap-2 rounded-[4px] px-2 py-1.5 text-ui ${i === menu.index ? "bg-[var(--fill-hover)]" : ""}`}
                >
                  <span className="w-20 shrink-0 font-medium text-[color:var(--text-primary)]">/{c.name}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-[color:var(--text-faint)]">{c.desc}</span>
                  <span className="shrink-0 text-2xs text-[color:var(--text-faint)]">
                    {c.custom && <span className="mr-1 rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-1 text-[color:var(--accent)]">自定义</span>}
                    {c.local ? "本地" : c.mode === "write" ? (c.output === "replace" ? "替换选区" : "写正文") : "讨论"}
                  </span>
                </div>
              ))
            : mentionItems.length === 0
              ? <div className="px-2 py-2 text-xs text-[color:var(--text-faint)]">没有匹配的章节、人物、伏笔、情节块或大纲</div>
              : mentionItems.map((m, i) => {
                  const Icon = KIND_ICON[m.kind];
                  return (
                    <div
                      key={`${m.kind}-${m.id}`}
                      role="option"
                      aria-selected={i === menu.index}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        pickMention(m);
                      }}
                      onMouseMove={() => setMenu({ ...menu, index: i })}
                      className={`flex cursor-default items-center gap-2 rounded-[4px] px-2 py-1.5 text-ui ${i === menu.index ? "bg-[var(--fill-hover)]" : ""}`}
                    >
                      <Icon size={13} className="shrink-0 text-[color:var(--text-faint)]" />
                      <span className="min-w-0 flex-1 truncate text-[color:var(--text-primary)]">{m.label}</span>
                      <span className="shrink-0 text-2xs text-[color:var(--text-faint)]">{KIND_LABEL[m.kind]}</span>
                    </div>
                  );
                })}
        </div>
      )}

      {/* 阶段 2C：排队待发的消息（这一轮结束后自动依次发出；「立即发送」= 停下当前生成马上发这条） */}
      {queue.length > 0 && (
        <div className="mb-1 flex flex-col gap-1" data-testid="chat-queue">
          {queue.map((q, i) => (
            <div key={i} className="flex items-center gap-1.5 rounded-[var(--r-control)] bg-[var(--fill-element)] px-2 py-1 text-2xs text-[color:var(--text-secondary)]">
              <Clock size={11} className="shrink-0 text-[color:var(--text-faint)]" />
              <span className="shrink-0 text-[color:var(--text-faint)]">排队 {i + 1}</span>
              <span className="min-w-0 flex-1 truncate">{q.text}</span>
              <button
                onClick={() => void useChat.getState().interject(i)}
                data-tip="停下当前生成（已生成的保留），马上发这条"
                className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[color:var(--accent)] hover:bg-[var(--fill-hover)]"
              >
                立即发送
              </button>
              <button aria-label="移出队列" onClick={() => useChat.getState().removeQueued(i)} className="shrink-0 rounded-[4px] p-0.5 text-[color:var(--text-faint)] hover:text-[color:var(--text-primary)]">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-[10px] border border-[color:var(--hairline)] bg-[var(--fill-element)] transition-colors duration-[var(--dur-md)] focus-within:border-[color:color-mix(in_srgb,var(--accent)_60%,transparent)]">
        {/* 上下文胶囊行 */}
        {(pills.length > 0 || quote || mentions.length > 0 || attachments.length > 0 || preset) && (
          <div className="flex flex-wrap items-center gap-1 px-2 pt-2" aria-label="本轮上下文">
            {preset && (
              <span data-ctx-preset={preset.name} className="flex max-w-40 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--success)_14%,transparent)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--success)]" data-tip="常驻上下文包：每轮都带上">
                <Package size={10} className="shrink-0" />
                <span className="truncate">{preset.name}</span>
                <button aria-label="取消上下文包" onClick={() => useCtxPresets.getState().setActive(null)} className="rounded-full p-0.5 hover:bg-[var(--fill-hover)]">
                  <X size={10} />
                </button>
              </span>
            )}
            {attachments.map((a) => (
              <span key={a.name} data-attachment={a.name} className="flex max-w-48 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--accent)]">
                <Paperclip size={10} className="shrink-0" />
                <span className="truncate">{a.name}</span>
                <span className="shrink-0 opacity-70">{a.text.length.toLocaleString()} 字</span>
                <button aria-label={`移除附件 ${a.name}`} onClick={() => useChat.getState().removeAttachment(a.name)} className="rounded-full p-0.5 hover:bg-[var(--fill-hover)]">
                  <X size={10} />
                </button>
              </span>
            ))}
            {quote && (
              <span className="flex max-w-56 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--accent)]" data-tip={quote.text.slice(0, 200)}>
                <Quote size={10} className="shrink-0" />
                <span className="truncate">选区「{quote.text.slice(0, 14)}{quote.text.length > 14 ? "…" : ""}」</span>
                <button aria-label="取消引用选区" onClick={() => setQuote(null)} className="rounded-full p-0.5 hover:bg-[var(--fill-hover)]">
                  <X size={10} />
                </button>
              </span>
            )}
            {mentions.map((m) => (
              <span key={`${m.kind}-${m.id}`} className="flex max-w-40 items-center gap-1 rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] py-0.5 pl-2 pr-1 text-2xs text-[color:var(--accent)]">
                <AtSign size={10} className="shrink-0" />
                <span className="truncate">{m.label}</span>
                <button aria-label={`移除引用 ${m.label}`} onClick={() => removeMention(m)} className="rounded-full p-0.5 hover:bg-[var(--fill-hover)]">
                  <X size={10} />
                </button>
              </span>
            ))}
            {pills.map((s) => (
              <button
                key={s.name}
                data-slot-pill={s.name}
                aria-pressed={!s.disabled}
                onClick={() => toggleSlot(s.name)}
                data-trimmed={s.trimmed ? "" : undefined}
                data-tip={`${s.reason ? `${s.reason}\n` : ""}${s.source} · ${s.chars} 字 · 约 ${s.est_tokens} tokens${s.trimmed ? "（超出上下文预算，本轮已裁）" : s.disabled ? "（本轮已关闭，点击打开）" : "（点击本轮关闭）"}`}
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs transition-[background-color,color,opacity] duration-[var(--dur-md)] [box-shadow:inset_0_0_0_1px_var(--hairline)] hover:bg-[var(--fill-hover)] ${
                  s.disabled ? "text-[color:var(--text-faint)] line-through opacity-60" : s.trimmed ? "border border-dashed border-[color:var(--danger)] text-[color:var(--danger)] opacity-70" : "text-[color:var(--text-secondary)]"
                }`}
              >
                {s.name}
                <span className="tabular-nums text-[color:var(--text-faint)]">{fmtTokens(s.est_tokens)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-start gap-1.5 px-2.5 pt-2">
          {command && (
            <span className="mt-0.5 flex shrink-0 items-center gap-0.5 rounded-[4px] bg-[var(--accent)] py-0.5 pl-1.5 pr-1 text-2xs font-medium text-white">
              /{command.name}
              <button aria-label="取消命令" onClick={() => setCommand(null)} className="rounded-[3px] p-px hover:bg-white/20">
                <X size={10} />
              </button>
            </span>
          )}
          <textarea
            ref={taRef}
            value={text}
            disabled={disabled}
            aria-label="AI 指令"
            onChange={(e) => {
              setText(e.target.value);
              updateMenu(e.target.value, e.target.selectionStart ?? e.target.value.length);
            }}
            onKeyDown={onKeyDown}
            onBlur={() => window.setTimeout(() => setMenu(null), 120)}
            rows={Math.min(8, Math.max(2, text.split("\n").length))}
            placeholder={
              disabled
                ? "选择章节后可用"
                : streaming
                  ? "生成中：回车排队，这一轮结束后自动发出"
                  : mode === "discuss"
                  ? "讨论剧情、人物、设定…  / 命令 · @ 引用 · Enter 发送"
                  : "描述这段要怎么写…  / 命令 · @ 引用 · Ctrl+L 引用选区"
            }
            className="min-h-0 flex-1 resize-none bg-transparent text-sm leading-relaxed text-[color:var(--text-primary)] outline-none placeholder:text-[color:var(--text-faint)]"
          />
        </div>

        {/* 底栏：命令 / 引用 / 长度 / 温度 · token · 发送 */}
        <div className="flex items-center gap-0.5 px-1.5 pb-1.5 pt-1 text-2xs text-[color:var(--text-faint)]">
          <button
            aria-label="斜杠命令"
            data-tip="命令（输入 / 也可）"
            disabled={disabled}
            onClick={() => {
              setText("/");
              setCommand(null);
              setMenu({ kind: "slash", query: "", index: 0 });
              taRef.current?.focus();
            }}
            className="rounded-[4px] p-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            <Slash size={13} />
          </button>
          <button
            aria-label="@ 引用"
            data-tip="引用章节 / 人物 / 伏笔 / 情节块 / 大纲（输入 @ 也可）"
            disabled={disabled}
            onClick={() => {
              const t = text.endsWith("@") ? text : text + "@";
              setText(t);
              void loadPool();
              setMenu({ kind: "mention", query: "", index: 0 });
              taRef.current?.focus();
            }}
            className="rounded-[4px] p-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            <AtSign size={13} />
          </button>
          <button
            aria-label="引用选区"
            data-tip="引用正文选区"
            data-tip-key="Ctrl+L"
            disabled={disabled}
            onClick={() => {
              if (!quoteSelection()) toast.info("先在正文中选中一段");
            }}
            className="rounded-[4px] p-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            <Quote size={13} />
          </button>
          <button
            aria-label="附件"
            data-tip="附件：参考稿 / 仿写样本（.txt .md .docx，只用于这一轮）"
            disabled={disabled}
            onClick={() => void attach()}
            className="rounded-[4px] p-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40"
          >
            <Paperclip size={13} />
          </button>
          <button
            aria-label="上下文包"
            data-tip="上下文包：存一组常用的引用 / 槽位开关，选中后每轮都带上"
            disabled={disabled}
            onClick={(e) => presetMenu(e.currentTarget)}
            className={`rounded-[4px] p-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] disabled:opacity-40 ${preset ? "text-[color:var(--success)]" : ""}`}
          >
            <Package size={13} />
          </button>
          <span aria-hidden className="mx-1 h-3 w-px bg-[var(--hairline)]" />
          <button
            data-tip="期望长度"
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                LENGTHS.map((n) => ({ label: n == null ? "不限长度" : `约 ${n} 字`, checked: targetChars === n, onSelect: () => setTargetChars(n) })),
              )
            }
            className="rounded-[4px] px-1.5 py-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
          >
            {targetChars == null ? "长度不限" : `约 ${targetChars} 字`}
          </button>
          <button
            data-tip="温度：越低越稳，越高越放飞"
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                TEMPS.map((t) => ({ label: t.label, checked: temperature === t.value, onSelect: () => setTemperature(t.value) })),
              )
            }
            className="rounded-[4px] px-1.5 py-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]"
          >
            {temperature == null ? "温度默认" : `温度 ${temperature}`}
          </button>
          <button
            data-tip="多候选：每轮生成几版并排对比，挑一版用"
            onClick={(e) =>
              openMenuAt(
                e.currentTarget,
                [1, 2, 3].map((n) => ({ label: n === 1 ? "单版" : `${n} 版并排`, checked: candidates === n, onSelect: () => setCandidates(n) })),
              )
            }
            className={`rounded-[4px] px-1.5 py-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] ${candidates > 1 ? "text-[color:var(--accent)]" : ""}`}
          >
            {candidates > 1 ? `候选 ×${candidates}` : "单版"}
          </button>
          <StyleSwitch className="rounded-[4px] px-1.5 py-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)]" />
          {manualRules.length > 0 && (
            <button
              data-tip="本轮手动选用的写作规则（发送后清空）"
              onClick={(e) =>
                openMenuAt(
                  e.currentTarget,
                  manualRules.map((r) => ({ label: r.title, checked: pickedRules.includes(r.id), onSelect: () => toggleRule(r.id) })),
                )
              }
              className={`rounded-[4px] px-1.5 py-1 transition-colors hover:bg-[var(--fill-hover)] hover:text-[color:var(--text-primary)] ${pickedRules.length > 0 ? "text-[color:var(--accent)]" : ""}`}
            >
              {pickedRules.length > 0 ? `规则 ${pickedRules.length}` : "规则"}
            </button>
          )}
          <div className="flex-1" />
          {totalTokens > 0 && (
            <span
              className={`mr-1.5 tabular-nums ${trimmedCount > 0 ? "text-[color:var(--danger)]" : ""}`}
              data-testid="composer-tokens"
              data-tip={trimmedCount > 0 ? `超出上下文预算，本轮已裁 ${trimmedCount} 个槽位（查看上下文预览）` : "本轮将发送的上下文估算（不含回答）/ 预算"}
            >
              ~{fmtTokens(totalTokens)}
              {budget > 0 ? ` / ${fmtTokens(budget)}` : ""} tokens
            </span>
          )}
          {streaming ? (
            <button
              onClick={() => void stop()}
              aria-label="停止生成"
              className="flex items-center gap-1 rounded-[var(--r-control)] bg-[color-mix(in_srgb,var(--danger)_14%,transparent)] px-2 py-1 font-medium text-[color:var(--danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--danger)_22%,transparent)]"
            >
              <Square size={11} />
              停止
            </button>
          ) : (
            <button
              onClick={() => void doSend()}
              disabled={disabled || (!text.trim() && !command)}
              aria-label="发送"
              data-tip="发送"
              data-tip-key="Enter"
              className="flex items-center justify-center rounded-[var(--r-control)] bg-[var(--accent)] p-1.5 text-white transition-[filter,opacity] hover:brightness-110 disabled:opacity-35"
            >
              <SendHorizontal size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
