// 阶段 2C 实机核验：AI P2（本地假服务，不需要真 Key）。
// 组 C1 对话：时间戳 / 会话内查找 / 👍👎 评分（按命令统计）/ 导出 Markdown / 另存为新章节与素材片段 / 生成中排队与插话
// 组 C2 输入与上下文：附件 / 上下文包（常驻）/ 词语偏置与「去掉重写」/ 正文 [待写指令] 与 {批注}
// 组 C3 编辑器内 AI：幽灵补全（默认关）/ 换个说法（近义词 + token 概率）/ 朗读（核验时不出声）
// 用法（应用已带调试端口启动）：node scripts/verify/p2c.mjs
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const SHOTS = ".tmp-verify/p2c";
const EXPORT = fileURLToPath(new URL("../../.tmp-verify/p2c/对话导出.md", import.meta.url));
const ATTACH = fileURLToPath(new URL("../../.tmp-verify/p2c/仿写样本.txt", import.meta.url));
const mock = await startMockLlm();

await withGuard("p2c", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = app.evaluate;
  const prevActive = await app.invoke("get_active_provider");
  const provider = await app.invoke("save_provider", {
    p: { id: 0, name: "核验假服务", base_url: mock.url, api_key: "sk-mock", model: "mock-model", max_tokens: 1024, temperature: 0.7 },
  });
  await app.invoke("set_active_provider", { id: provider.id });
  try {
    const { book, ids } = await makeBook("阶段二C", [
      ["第一章 渡口", "渡口的灯笼次第亮起。沈砚站在船头。"],
      ["第二章 旧城", "旧城灯会。林晚递来半张地图。\n\n她没有回头。"],
      ["第三章 雨夜", "雨很大。{林晚此时还不知道真相}\n\n[写一场雨中打斗]\n\n他走了。"],
    ]);
    await app.invoke("character_upsert", { input: { id: null, book_id: book.id, name: "沈砚", role: "主角", aliases: "", description: "守渡口的冷面剑客" } });
    await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.chat.backend', 'provider'); localStorage.setItem('bixian.nav.view', 'write'); true`);
    await app.reload();
    await ev(`(() => { window.__nativeDialogs = []; for (const k of ['alert','confirm','prompt']) { window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; } return true })()`);
    await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[1]}"]')`, 8000);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('她没有回头')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);

    const typeInComposer = async (text) => {
      await app.clickEl(`document.querySelector('textarea[aria-label="AI 指令"]')`);
      await app.press("a", { ctrl: true });
      await app.press("Backspace");
      if (text) await app.typeText(text);
      await sleep(150);
    };
    const waitIdle = async (ms = 10000) => {
      await sleep(150);
      await waitFor(ev, `!document.querySelector('button[aria-label="停止生成"]')`, ms);
      await sleep(250);
    };
    const lastReply = `[...document.querySelectorAll('[data-reply]')].at(-1)`;
    const menuItem = async (text) => {
      await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes(${JSON.stringify(text)}))`);
      await sleep(200);
    };
    const confirmPrompt = async (value) => {
      await waitFor(ev, `!!document.querySelector('[role="dialog"] input, [role="alertdialog"] input')`, 4000);
      if (value != null) {
        await app.clickEl(`document.querySelector('[role="dialog"] input, [role="alertdialog"] input')`);
        await app.press("a", { ctrl: true });
        await app.typeText(value);
      }
      await app.press("Enter");
      await sleep(300);
    };

    // ================= C1 对话 =================
    // 斜杠命令发一轮（/续写），回答带命令
    await typeInComposer("/续写");
    await waitFor(ev, `!!document.querySelector('[role="listbox"][aria-label="命令"] [role="option"]')`);
    await app.press("Enter");
    await sleep(150);
    await app.press("Enter");
    await waitIdle();
    await waitFor(ev, `!!${lastReply}`, 5000);
    const times = await ev(`[...document.querySelectorAll('[data-msg-time]')].map(t => t.textContent.trim())`);
    check("问题与回答都显示时间（本地时间 时:分）", times.length >= 2 && times.every((t) => /\d{2}:\d{2}/.test(t)), times.join(" | "));
    // 评分 → 按命令统计
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="有用"]')`);
    await waitFor(ev, `${lastReply}.querySelector('button[aria-label="有用"]').getAttribute('aria-pressed') === 'true'`, 3000);
    const stats = await app.invoke("rating_stats");
    check("👍 落库并按命令统计（/续写 +1）", stats.some((s) => s.command === "continue" && s.up >= 1), JSON.stringify(stats));
    // 会话内查找：焦点在 AI 卡里 Ctrl+F
    await app.clickEl(`document.querySelector('[data-message-list]')`);
    await app.press("f", { ctrl: true });
    await waitFor(ev, `!!document.querySelector('[data-testid="chat-find"]')`, 3000);
    await app.typeText("夜雨");
    await sleep(300);
    const found = Number(await ev(`document.querySelector('[data-testid="chat-find"]').getAttribute('data-find-count')`));
    check("Ctrl+F 会话内查找：命中计数并高亮", found >= 1, `命中 ${found}`);
    check("高亮走 CSS 自定义高亮（不改消息 DOM）", await ev(`!!CSS.highlights?.get('chat-find') && CSS.highlights.get('chat-find').size >= 1`));
    await app.screenshot(`${SHOTS}/find.png`);
    await app.press("Escape");
    await sleep(200);
    check("Esc 关闭查找、高亮清除", await ev(`!document.querySelector('[data-testid="chat-find"]') && !CSS.highlights.get('chat-find')`));
    // 导出 Markdown：原生保存对话框 CDP 点不到——用开发构建里的核验钩子预置保存路径（只用一次）
    rmSync(EXPORT, { force: true });
    await ev(`window.__e2eSavePath = ${JSON.stringify(EXPORT)}; window.__e2eSaveCalls = 0; true`);
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    await menuItem("导出对话为 Markdown");
    for (let i = 0; i < 30 && !existsSync(EXPORT); i++) await sleep(150);
    await sleep(300);
    const md = existsSync(EXPORT) ? readFileSync(EXPORT, "utf8") : "";
    check("导出对话为 Markdown：标题、我 / AI、命令名与评分", md.startsWith("# ") && md.includes("## 我") && md.includes("/续写") && md.includes("👍") && md.includes("夜雨初歇"), md.slice(0, 80).replace(/\n/g, "⏎"));
    check("点一次只导出一次（不会弹两个保存框）", (await ev(`window.__e2eSaveCalls`)) === 1 && (await ev(`window.__e2eSavePath === undefined`)));
    // 另存为新章节（备选稿）
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="更多"]')`);
    await menuItem("另存为新章节");
    await confirmPrompt("旧城（备选）");
    await sleep(500);
    const chapters = await app.invoke("list_chapters", { bookId: book.id });
    const alt = chapters.find((c) => c.title === "旧城（备选）");
    const altBody = alt ? (await app.invoke("read_chapter", { id: alt.id })).content : "";
    check("另存为新章节：紧随本章、正文为清洗后的回答", !!alt && chapters.findIndex((c) => c.id === alt.id) === chapters.findIndex((c) => c.id === ids[1]) + 1 && altBody.includes("夜雨初歇") && !altBody.includes("以下是续写"), altBody.slice(0, 30));
    // 存为素材片段
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="更多"]')`);
    await menuItem("存为素材片段");
    await confirmPrompt("渡口夜雨");
    await sleep(400);
    const mats = await app.invoke("materials_list", { query: null });
    check("存为素材片段：素材库「片段」", mats.some((m) => m.category === "片段" && m.title === "渡口夜雨"));
    // 生成中排队：慢流时再发一条 → 结束后自动发出
    await typeInComposer("【慢】写一段长的");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('button[aria-label="停止生成"]')`, 5000);
    await typeInComposer("排队的第二问");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('[data-testid="chat-queue"]')`, 3000);
    check("生成中回车 = 排队（输入区上方显示排队 1）", (await ev(`document.querySelector('[data-testid="chat-queue"]').innerText`)).includes("排队的第二问"));
    await app.screenshot(`${SHOTS}/queue.png`);
    await waitFor(ev, `!document.querySelector('[data-testid="chat-queue"]')`, 15000);
    await waitIdle(15000);
    check("这一轮结束后自动发出排队的消息", mock.lastRequest().messages.at(-1).content.includes("排队的第二问"));
    // 插话：慢流中排一条，点「立即发送」→ 停下当前（已生成部分保留）并马上发
    await typeInComposer("【慢】再写一段长的");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('button[aria-label="停止生成"]')`, 5000);
    await sleep(400);
    await typeInComposer("插话：先停一下");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('[data-testid="chat-queue"]')`, 3000);
    const reqsBefore = mock.requests.length;
    await app.clickEl(`[...document.querySelectorAll('[data-testid="chat-queue"] button')].find(b => b.textContent === '立即发送')`);
    await waitFor(ev, `!document.querySelector('[data-testid="chat-queue"]')`, 8000);
    await waitIdle(15000);
    const interjected = mock.requests.slice(reqsBefore).some((r) => r.messages.at(-1).content.includes("插话：先停一下"));
    const replies = await ev(`[...document.querySelectorAll('[data-reply]')].map(r => r.innerText)`);
    check("插话：停下当前生成（已生成部分保留）并立即发出", interjected && replies.some((t) => t.includes("夜雨初歇") && !t.includes("生成中断")), `新请求 ${mock.requests.length - reqsBefore}`);

    // ================= C2 输入与上下文 =================
    // 附件：开发构建的核验钩子预置「打开文件」的路径
    mkdirSync(fileURLToPath(new URL("../../.tmp-verify/p2c/", import.meta.url)), { recursive: true });
    writeFileSync(ATTACH, "仿写样本：雪落无声，渡口只剩一盏灯。");
    await ev(`window.__e2eOpenPath = ${JSON.stringify(ATTACH)}; true`);
    await app.clickEl(`document.querySelector('button[aria-label="附件"]')`);
    await waitFor(ev, `!!document.querySelector('[data-attachment="仿写样本.txt"]')`, 4000);
    check("附件：读出文本、输入区出现附件胶囊", true);
    await typeInComposer("照附件的味道写一段");
    await app.press("Enter");
    await waitIdle();
    const ra = mock.lastRequest().messages.at(-1).content;
    check("附件随本轮发送（用户消息里的【附件】块）", ra.includes("【附件") && ra.includes("《仿写样本.txt》") && ra.includes("雪落无声"), ra.slice(0, 40));
    check("发出后附件胶囊清空、问题旁标出附件名", (await ev(`!document.querySelector('[data-attachment]')`)) && (await ev(`[...document.querySelectorAll('[data-attached]')].some(e => e.textContent.includes('仿写样本.txt'))`)));
    // 上下文包：@ 引用人物 → 存为上下文包 → 之后每轮都带上
    await typeInComposer("@沈");
    await waitFor(ev, `!!document.querySelector('[role="listbox"][aria-label="引用"] [role="option"]')`, 4000);
    await app.press("Enter");
    await sleep(200);
    await app.clickEl(`document.querySelector('button[aria-label="上下文包"]')`);
    await menuItem("把当前设置存为上下文包");
    await confirmPrompt("渡口戏");
    await waitFor(ev, `!!document.querySelector('[data-ctx-preset="渡口戏"]')`, 3000);
    await typeInComposer("第一轮");
    await app.press("Enter");
    await waitIdle();
    await typeInComposer("第二轮（没再 @）");
    await app.press("Enter");
    await waitIdle();
    const r2sys = mock.lastRequest().messages[0].content;
    check("上下文包常驻：没再 @ 的下一轮也带着包里的引用", r2sys.includes("【引用资料】") && r2sys.includes("守渡口的冷面剑客") && (await ev(`!!document.querySelector('[data-ctx-preset="渡口戏"]')`)));
    const stored = JSON.parse((await app.invoke("setting_get", { key: `ctx_presets:${book.id}` })) ?? "[]");
    check("上下文包按书存进设置", stored.length === 1 && stored[0].name === "渡口戏" && stored[0].mentions.some((m) => m.label === "沈砚"));
    await app.clickEl(`document.querySelector('button[aria-label="取消上下文包"]')`);
    await sleep(200);
    // 词语偏置：本书禁用一条 + 一条「所有书通用」（withGuard 清掉通用的）
    await app.clickEl(`document.querySelector('button[aria-label="记忆与规则"]')`);
    await waitFor(ev, `!!document.querySelector('[data-testid="phrase-bias"]')`, 4000);
    await app.clickEl(`document.querySelector('input[aria-label="添加词语"]')`);
    await app.typeText("嘴角勾起一抹弧度");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('[data-phrase="嘴角勾起一抹弧度"]')`, 3000);
    await app.clickEl(`document.querySelector('input[aria-label="添加词语"]')`);
    await app.typeText("核验通用词");
    await app.clickEl(`[...document.querySelectorAll('[data-testid="phrase-bias"] label')].find(l => l.textContent.includes('所有书通用')).querySelector('input')`);
    await app.clickEl(`[...document.querySelectorAll('[data-testid="phrase-bias"] button')].find(b => b.textContent === '添加')`);
    await waitFor(ev, `!!document.querySelector('[data-phrase="核验通用词"]')`, 3000);
    await app.screenshot(`${SHOTS}/phrase-bias.png`);
    await app.clickEl(`document.querySelector('button[aria-label="记忆与规则"]')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);
    await typeInComposer("【AI腔】写一句");
    await app.press("Enter");
    await waitIdle();
    const rb = mock.lastRequest().messages[0].content;
    check("词语偏置进 system【用词要求】", rb.includes("【用词要求】") && rb.includes("嘴角勾起一抹弧度") && rb.includes("核验通用词"));
    await waitFor(ev, `!!${lastReply}.querySelector('[data-cliches]')`, 3000);
    check("回答里出现禁用表达 → 提示「含 AI 腔 1 处」", (await ev(`${lastReply}.querySelector('[data-cliches]').getAttribute('data-cliches')`)) === "1");
    await app.clickEl(`[...${lastReply}.querySelectorAll('button')].find(b => b.textContent === '去掉重写')`);
    await waitIdle();
    check("「去掉重写」：带上要求重新生成", mock.lastRequest().messages.at(-1).content.includes("不要用这些表达：嘴角勾起一抹弧度"));
    // 正文里的 [待写指令] / {批注}
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[2]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('他走了')`);
    check("编辑器里标出 [待写指令] 与 {批注}", (await ev(`!!document.querySelector('.ProseMirror [data-directive="todo"]') && !!document.querySelector('.ProseMirror [data-directive="note"]')`)));
    await ev(`(() => { const el = document.querySelector('.ProseMirror [data-directive="todo"]'); const t = el.firstChild; const r = document.createRange(); r.setStart(t, 3); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); document.querySelector('.ProseMirror').focus(); return true })()`);
    await sleep(200);
    await app.press("Enter", { alt: true });
    await waitFor(ev, `document.querySelector('[data-inline-ai="continue"]')?.getAttribute('data-status') === 'done'`, 8000);
    const rd = mock.lastRequest();
    check("Alt+Enter 在 [指令] 里：按指令写；{批注} 进 system、正文上下文里剔除", rd.messages.at(-1).content.includes("按这条指令写一段正文：写一场雨中打斗") && rd.messages[0].content.includes("- 林晚此时还不知道真相") && !rd.messages.at(-1).content.includes("{林晚"));
    await app.screenshot(`${SHOTS}/directive.png`);
    await app.press("Enter");
    await waitFor(ev, `!document.querySelector('.ProseMirror').textContent.includes('[写一场雨中打斗]')`, 4000);
    check("应用：AI 写的正文替换掉整个方括号", (await ev(`document.querySelector('.ProseMirror').textContent`)).includes("夜雨初歇"));

    // ================= C3 编辑器内 AI =================
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[0]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('沈砚站在船头')`);
    check("幽灵补全默认关", (await ev(`localStorage.getItem('bixian.ghost')`)) !== "1");
    const editorMore = `document.querySelector('.ProseMirror').closest('.relative').querySelector('button[aria-label="更多"]')`;
    await app.clickEl(editorMore);
    await menuItem("幽灵补全");
    const caretEnd = () => ev(`(() => { const ed = document.querySelector('.ProseMirror'); const p = [...ed.querySelectorAll('p')].at(-1); ed.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`);
    await caretEnd();
    await sleep(150);
    await app.typeText("夜深了");
    await waitFor(ev, `!!document.querySelector('.ProseMirror [data-ghost]')`, 6000);
    const ghostText = await ev(`document.querySelector('.ProseMirror [data-ghost]').textContent`);
    check("停顿后光标处出现灰字建议（不进文档）", ghostText.includes("夜雨初歇") && !(await ev(`document.querySelector('.ProseMirror').textContent`)).includes("渡口的灯笼次第亮起。夜") , ghostText);
    await app.screenshot(`${SHOTS}/ghost.png`);
    await app.press("Tab");
    await sleep(200);
    check("Tab 接受：灰字写进正文", (await ev(`document.querySelector('.ProseMirror').textContent`)).includes("夜深了夜雨初歇"));
    await app.typeText("。");
    await waitFor(ev, `!!document.querySelector('.ProseMirror [data-ghost]')`, 6000);
    await app.press("Escape");
    await sleep(150);
    check("Esc：灰字消失、正文不变", !(await ev(`!!document.querySelector('.ProseMirror [data-ghost]')`)) && (await ev(`document.querySelector('.ProseMirror').textContent`)).endsWith("。"));
    await app.clickEl(editorMore);
    await menuItem("幽灵补全");
    // 换个说法
    await ev(`(() => { const ed = document.querySelector('.ProseMirror'); const p = [...ed.querySelectorAll('p')].find(x => x.textContent.includes('灯笼')); const t = [...p.childNodes].find(n => n.nodeType === 3 && n.data.includes('灯笼')); const i = t.data.indexOf('灯笼'); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 2); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return true })()`);
    await sleep(400);
    await waitFor(ev, `!!document.querySelector('[data-bubble-menu]')`, 4000);
    await app.clickEl(`[...document.querySelectorAll('[data-bubble-menu] button')].find(b => b.textContent === '换个说法')`);
    await waitFor(ev, `!!document.querySelector('[data-testid="word-swap"] [data-synonyms]') && !!document.querySelector('[data-testid="word-swap"] [data-alternatives]')`, 8000);
    const swapText = await ev(`document.querySelector('[data-testid="word-swap"]').innerText`);
    check("换个说法：近义词 / 成语 + 此处最可能的字与概率", swapText.includes("凛冽") && swapText.includes("寒") && /\d+%/.test(swapText), swapText.replace(/\n/g, " ").slice(0, 60));
    await app.screenshot(`${SHOTS}/word-swap.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-testid="word-swap"] button')].find(b => b.textContent === '凛冽')`);
    await sleep(300);
    check("点一个即替换选中的词", (await ev(`document.querySelector('.ProseMirror').textContent`)).includes("渡口的凛冽次第亮起"));
    // 朗读（核验时把系统语音换成静音桩，只验接线）：本章对话里先有一条回答
    await typeInComposer("写一句");
    await app.press("Enter");
    await waitIdle();
    await ev(`(() => { window.__spoken = []; speechSynthesis.speak = (u) => { window.__spoken.push(u.text); }; return true })()`);
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="朗读回答"]')`);
    await waitFor(ev, `!!document.querySelector('[data-testid="speech-chip"]')`, 3000);
    check("朗读回答：逐段交给系统语音、出现朗读条", (await ev(`window.__spoken.length`)) >= 1);
    await app.clickEl(`document.querySelector('button[aria-label="停止朗读"]')`);
    await sleep(150);
    check("停止朗读：朗读条消失", !(await ev(`!!document.querySelector('[data-testid="speech-chip"]')`)));

    check("全程没有原生对话框", (await ev(`(window.__nativeDialogs ?? []).length`)) === 0);
    await app.screenshot(`${SHOTS}/final.png`);
    return summary();
  } finally {
    await app.invoke("delete_provider", { id: provider.id }).catch(() => {});
    if (prevActive != null) await app.invoke("set_active_provider", { id: prevActive }).catch(() => {});
    await mock.close();
    rmSync(EXPORT, { force: true });
    rmSync(ATTACH, { force: true });
  }
});
