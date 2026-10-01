// 阶段 2C 实机核验：AI P2（本地假服务，不需要真 Key）。
// 组 C1 对话：时间戳 / 会话内查找 / 👍👎 评分（按命令统计）/ 导出 Markdown / 另存为新章节与素材片段 / 生成中排队与插话
// 用法（应用已带调试端口启动）：node scripts/verify/p2c.mjs
import { existsSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const SHOTS = ".tmp-verify/p2c";
const EXPORT = fileURLToPath(new URL("../../.tmp-verify/p2c/对话导出.md", import.meta.url));
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
    ]);
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

    check("全程没有原生对话框", (await ev(`(window.__nativeDialogs ?? []).length`)) === 0);
    await app.screenshot(`${SHOTS}/final.png`);
    return summary();
  } finally {
    await app.invoke("delete_provider", { id: provider.id }).catch(() => {});
    if (prevActive != null) await app.invoke("set_active_provider", { id: prevActive }).catch(() => {});
    await mock.close();
    rmSync(EXPORT, { force: true });
  }
});
