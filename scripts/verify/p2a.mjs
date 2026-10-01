// 阶段 2A 实机核验：AI 对话（本地假服务，不需要真 Key）。
// 多轮 / 斜杠命令 / 采纳三式 + 撤销 / 重新生成版本 / 编辑重发 / 错误分类重试 / 断流半截保留 /
// 停止保留 / 新会话 / 选区气泡润色 + 差异替换 / @ 引用 / 槽位开关 / 草稿保存。
// 用法（应用已带调试端口启动）：node scripts/verify/p2a.mjs
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const SHOTS = ".tmp-verify/p2a";
const mock = await startMockLlm();

await withGuard("p2a", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = app.evaluate;
  // ---- 临时服务商（结束删除并还原原「使用中」）----
  const prevActive = await app.invoke("get_active_provider");
  const provider = await app.invoke("save_provider", {
    p: { id: 0, name: "核验假服务", base_url: mock.url, api_key: "sk-mock", model: "mock-model", max_tokens: 1024, temperature: 0.7 },
  });
  await app.invoke("set_active_provider", { id: provider.id });
  try {
    const { book, ids } = await makeBook("阶段二A", [
      ["第一章 渡口", "渡口的灯笼次第亮起。沈砚站在船头。"],
      ["第二章 旧城", "旧城灯会。林晚递来半张地图。\n\n她没有回头。"],
    ]);
    await app.invoke("character_upsert", { input: { id: null, book_id: book.id, name: "南宫婉", role: "女主", aliases: "", description: "冷傲寡言" } });
    await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.chat.backend', 'provider'); localStorage.setItem('bixian.nav.view', 'write'); true`);
    await app.reload();
    await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[1]}"]')`, 8000);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('她没有回头')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);

    const typeInComposer = async (text) => {
      await app.clickEl(`document.querySelector('textarea[aria-label="AI 指令"]')`);
      await app.press("a", { ctrl: true });
      await app.press("Backspace");
      await app.typeText(text);
      await sleep(150);
    };
    const waitIdle = () => waitFor(ev, `!document.querySelector('button[aria-label="停止生成"]')`, 10000);
    const replies = () => ev(`[...document.querySelectorAll('[data-reply]')].map(r => r.innerText)`);
    // 光标放到正文末尾
    const caretToEnd = () => ev(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`);

    // ① 斜杠命令：/xx → 选中「续写」→ 发送 → 流式完成；请求为光标感知
    await caretToEnd();
    await typeInComposer("/xx");
    const slashFirst = await waitFor(ev, `document.querySelector('[role="listbox"][aria-label="命令"] [role="option"]')?.textContent`);
    check("斜杠菜单拼音首字母：/xx → 续写", slashFirst.includes("/续写"), slashFirst);
    await app.press("Enter"); // 选中命令（模板入框）
    await sleep(100);
    check("选中命令后出现命令胶囊并填入模板", await ev(`document.querySelector('textarea[aria-label="AI 指令"]').value.includes('接着光标处')`));
    await app.press("Enter"); // 发送
    await waitIdle();
    await waitFor(ev, `[...document.querySelectorAll('[data-reply]')].some(r => r.innerText.includes('夜雨初歇'))`);
    const req1 = mock.lastRequest();
    const user1 = req1.messages.at(-1).content;
    check("写正文请求：光标前文 + 写作指令 + 长度提示", user1.includes("【光标前文") && user1.includes("她没有回头") && user1.includes("（本次输出约 800 字）"), user1.slice(0, 60));
    check("system 含上一章结尾前情", req1.messages[0].content.includes("【上一章结尾】") && req1.messages[0].content.includes("沈砚站在船头"));

    // ② 采纳：插入光标处（清洗掉「好的，以下是续写内容：」）→ 撤销
    await app.clickEl(`[...document.querySelectorAll('[data-reply] button')].find(b => b.textContent.includes('插入光标处'))`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('夜雨初歇')`);
    const docAfter = await ev(`document.querySelector('.ProseMirror').textContent`);
    check("插入光标处：正文出现 AI 段落且开场白被清洗", docAfter.includes("夜雨初歇") && !docAfter.includes("以下是续写"), docAfter.slice(-40));
    check("回答标记「已采纳」", await ev(`[...document.querySelectorAll('[data-reply]')].some(r => r.innerText.includes('已采纳'))`));
    await app.clickEl(`[...document.querySelectorAll('[data-testid="toast"] button')].find(b => b.textContent === '撤销')`);
    await waitFor(ev, `!document.querySelector('.ProseMirror')?.textContent.includes('夜雨初歇')`);
    // 原文必须还在：载入若留在撤销栈里，撤销会连载入一起撤掉、正文变空（阶段 3B 修复）
    check("Toast 撤销：一步回退插入、原文还在", await ev(`document.querySelector('.ProseMirror').textContent.includes('旧城灯会')`));

    // ③ 重新生成：出现 ‹2/2›，可切回 1/2
    await app.clickEl(`[...document.querySelectorAll('[data-reply] button')].find(b => b.getAttribute('aria-label') === '重新生成')`);
    await waitIdle();
    await waitFor(ev, `document.querySelector('[data-variant-index]')?.textContent.trim() === '2/2'`);
    check("重新生成保留旧版本：‹2/2›", true);
    await app.clickEl(`document.querySelector('button[aria-label="上一个版本"]')`);
    await waitFor(ev, `document.querySelector('[data-variant-index]')?.textContent.trim() === '1/2'`);
    check("切回 1/2", true);

    // ④ 讨论模式多轮：请求带上此前对话
    await app.clickEl(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent === '讨论')`);
    await typeInComposer("刚才那段节奏怎么样？");
    await app.press("Enter");
    await waitIdle();
    await waitFor(ev, `[...document.querySelectorAll('[data-reply]')].some(r => r.innerText.includes('节奏可以再快'))`);
    const req2 = mock.lastRequest();
    check("讨论模式：顾问提示 + 带上一轮问答（多轮）", req2.messages[0].content.includes("写作顾问") && req2.messages.length >= 4 && req2.messages.some((m) => m.role === "assistant"), `messages=${req2.messages.length}`);
    check("讨论回答按 Markdown 渲染（粗体）", await ev(`[...document.querySelectorAll('[data-reply] strong')].some(s => s.textContent === '建议')`));

    // ⑤ 编辑重发：改问题 → 其后对话移除并重新生成
    const before = (await replies()).length;
    await ev(`(() => { const btns = [...document.querySelectorAll('button[aria-label="编辑并重新发送"]')]; btns[btns.length - 1].click(); return true })()`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="编辑问题"]')`);
    await app.press("a", { ctrl: true });
    await app.typeText("这段对话写得自然吗？");
    await app.press("Enter");
    await waitIdle();
    await sleep(300);
    const lastUser = await ev(`[...document.querySelectorAll('.whitespace-pre-wrap.break-words')].map(e => e.textContent).at(-1)`);
    check("编辑重发：问题已改写并重新生成", lastUser === "这段对话写得自然吗？" && (await replies()).length === before, lastUser);

    // ⑥ 限流：错误分类 + 重试按钮
    await typeInComposer("【429】测试限流");
    await app.press("Enter");
    const alertText = await waitFor(ev, `[...document.querySelectorAll('[role="alert"]')].map(a => a.innerText).find(t => t.includes('限流'))`, 8000);
    check("429 → 「被限流」说明 + 重试", alertText.includes("重试"), alertText.slice(0, 40));
    await app.screenshot(`${SHOTS}/rate-limit.png`);
    await ev(`document.querySelector('button[aria-label="关闭错误提示"]')?.click()`);

    // ⑦ 断流：已生成的前半保留并标「生成中断」
    await app.clickEl(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent === '写正文')`);
    await typeInComposer("【断流】写一段");
    await app.press("Enter");
    await waitFor(ev, `[...document.querySelectorAll('[data-reply]')].some(r => r.innerText.includes('生成中断'))`, 10000);
    check("断流：半截保留 + 「生成中断，已保留前半」+「继续写」", await ev(`[...document.querySelectorAll('[data-reply] button')].some(b => b.textContent.includes('继续写'))`));
    await ev(`document.querySelector('button[aria-label="关闭错误提示"]')?.click()`);

    // ⑧ 停止：慢流中途停止，已生成部分作为回答保留
    await typeInComposer("【慢】写一段长的");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('button[aria-label="停止生成"]')`);
    await sleep(500);
    await app.clickEl(`document.querySelector('button[aria-label="停止生成"]')`);
    await waitIdle();
    await sleep(400);
    const stopped = (await replies()).at(-1);
    check("停止：已生成部分保留为回答", stopped.includes("夜雨初歇") && !stopped.includes("生成中断"), stopped.slice(0, 30));

    // ⑨ @ 引用人物 + 关闭「上一章结尾」胶囊：请求按本轮上下文组装
    await typeInComposer("@南宫");
    await waitFor(ev, `!!document.querySelector('[role="listbox"][aria-label="引用"] [role="option"]')`);
    await app.press("Enter");
    await sleep(200);
    check("@ 选中后变成引用胶囊", await ev(`!!document.querySelector('button[aria-label="移除引用 南宫婉"]')`));
    await waitFor(ev, `!!document.querySelector('[data-slot-pill="上一章结尾"]')`, 6000);
    await app.clickEl(`document.querySelector('[data-slot-pill="上一章结尾"]')`);
    await sleep(150);
    await app.typeText("她会怎么回应");
    await app.press("Enter");
    await waitIdle();
    const req3 = mock.lastRequest();
    check("@ 引用注入「引用资料」", req3.messages[0].content.includes("【引用资料】") && req3.messages[0].content.includes("南宫婉"));
    check("关闭的槽位本轮不注入", !req3.messages[0].content.includes("【上一章结尾】"));

    // ⑩ 选区气泡 → 润色 → 替换选区（差异预览）→ 接受
    await ev(`(() => { const ed = document.querySelector('.ProseMirror'); const p = [...ed.querySelectorAll('p')].find(x => x.textContent.includes('旧城灯会')); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return true })()`);
    await sleep(400);
    await waitFor(ev, `!!document.querySelector('[data-bubble-menu]')`, 4000);
    await app.screenshot(`${SHOTS}/bubble.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-bubble-menu] button')].find(b => b.textContent === '润色')`);
    await waitIdle();
    const req4 = mock.lastRequest();
    check("气泡「润色」：请求含选中段落与润色指令", req4.messages.at(-1).content.includes("【选中段落】\n旧城灯会") && req4.messages.at(-1).content.includes("润色"));
    await app.clickEl(`[...document.querySelectorAll('[data-reply] button')].filter(b => b.textContent.includes('替换选区')).at(-1)`);
    await waitFor(ev, `!!document.querySelector('[data-testid="diff-review"]')`);
    await app.screenshot(`${SHOTS}/diff.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-testid="diff-review"] button')].find(b => b.textContent === '接受替换')`);
    await waitFor(ev, `!document.querySelector('.ProseMirror')?.textContent.includes('旧城灯会')`);
    check("差异预览接受 → 选区被替换", await ev(`document.querySelector('.ProseMirror').textContent.includes('夜雨初歇') && document.querySelector('.ProseMirror').textContent.includes('她没有回头')`));

    // ⑪ 新会话 + 切回
    await app.clickEl(`document.querySelector('button[aria-label="新对话"]')`);
    await sleep(500);
    check("新对话：空态出现建议芯片", await ev(`[...document.querySelectorAll('button')].some(b => b.textContent === '/续写')`));
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    const sessionsInMenu = await waitFor(ev, `[...document.querySelectorAll('[role="menuitem"]')].length`);
    check("对话菜单列出本章多个会话", sessionsInMenu >= 4, `${sessionsInMenu} 项`);
    await app.press("Escape");
    await sleep(300); // 菜单关闭后焦点归还给触发按钮，等它落定再操作

    // ⑫ 草稿：输入未发送 → 切章 → 切回仍在
    await typeInComposer("一段没发出去的草稿");
    const typed = await ev(`document.querySelector('textarea[aria-label="AI 指令"]').value`);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[0]}"]')`);
    await sleep(600);
    const keys = await ev(`JSON.stringify(Object.entries(localStorage).filter(([k]) => k.includes('draft')))`);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
    await sleep(800);
    const back = await ev(`document.querySelector('textarea[aria-label="AI 指令"]').value`);
    check("草稿按章节保存：切章再切回仍在", back === "一段没发出去的草稿", `typed=${typed} keys=${keys} back=${back}`);
    await typeInComposer("");
    await app.screenshot(`${SHOTS}/final.png`);

    // 统计：AI 写入与撤销都不计入今日手写字数
    const today = await ev(`([...document.querySelectorAll('span')].find(s => s.textContent.startsWith('今日'))?.textContent ?? '').replace(/[今日字\s]/g, '')`);
    const todayNum = (today.match(/-?\d[\d,]*/) ?? [""])[0];
    check("AI 插入/撤销/替换不计入今日字数", todayNum === "0", `今日 ${todayNum} 字`);

    // 磁盘：采纳替换已落盘
    await sleep(1200);
    const disk = (await app.invoke("read_chapter", { id: ids[1] })).content;
    check("替换结果已自动保存到磁盘", disk.includes("夜雨初歇") && !disk.includes("旧城灯会"));
    return summary();
  } finally {
    await app.invoke("delete_provider", { id: provider.id }).catch(() => {});
    if (prevActive != null) await app.invoke("set_active_provider", { id: prevActive }).catch(() => {});
    await mock.close();
  }
});
