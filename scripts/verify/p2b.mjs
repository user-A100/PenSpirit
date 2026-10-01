// 阶段 2B 实机核验：AI 对话补齐（本地假服务，不需要真 Key）。
// 组 1 上下文：常驻记忆 / 作者注 / 写作规则 / 对 AI 隐藏 / 预算条
// 组 2 生成：多候选 / 带要求重试 / 走向 / 压缩 / token 计数
// 组 3 会话：收藏进素材库 / 分叉 / 置顶归档 / 全书搜索跳转 / 抽取情节块 / 存为梗概 / 最大化
// 组 4 采纳：逐段取舍 / AI 着色 / 恢复到采纳之前 / 只采纳选中部分 / Alt+K 就地改写 / Alt+Enter 续写浮条
// 组 5 agent：工具调用折叠 / 权限卡排队与「本会话一直允许」/ 回合文件改动全部撤销与恢复（本地假 ACP agent）
// 用法（应用已带调试端口启动）：node scripts/verify/p2b.mjs
import { fileURLToPath } from "node:url";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";
import { startMockLlm } from "./mock-llm.mjs";

const SHOTS = ".tmp-verify/p2b";
const mock = await startMockLlm();

await withGuard("p2b", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = app.evaluate;
  // ---- 临时服务商（结束删除并还原原「使用中」）；收藏产生的素材由 withGuard 清场时删掉 ----
  const prevActive = await app.invoke("get_active_provider");
  const provider = await app.invoke("save_provider", {
    p: { id: 0, name: "核验假服务", base_url: mock.url, api_key: "sk-mock", model: "mock-model", max_tokens: 1024, temperature: 0.7 },
  });
  await app.invoke("set_active_provider", { id: provider.id });
  const materialsBefore = new Set((await app.invoke("materials_list", { query: null })).map((m) => m.id));
  try {
    const P3 = ["逐段核验甲：原稿的第一段，写得平平。", "逐段核验乙：这一段不需要改。", "逐段核验丙：原稿的第三段，也写得平平。"];
    const { book, ids } = await makeBook("阶段二B", [
      ["第一章 渡口", "渡口的灯笼次第亮起。沈砚站在船头。"],
      ["第二章 旧城", [...P3, "旧城灯会。林晚递来半张地图。南宫婉与沈砚擦肩而过。", "她没有回头。"].join("\n\n")],
      ["第三章 雪夜", "雪夜无声。"],
    ]);
    const shen = await app.invoke("character_upsert", { input: { id: null, book_id: book.id, name: "沈砚", role: "主角", aliases: "", description: "守渡口的冷面剑客" } });
    const nan = await app.invoke("character_upsert", { input: { id: null, book_id: book.id, name: "南宫婉", role: "女主", aliases: "", description: "冷傲寡言，真实身份是敌国公主" } });
    await app.invoke("card_set_ai_hidden", { kind: "character", id: nan.id, hidden: true });
    void shen;
    await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.chat.backend', 'provider'); localStorage.setItem('bixian.nav.view', 'write'); true`);
    await app.reload();
    // 重载会冲掉 withGuard 装的原生对话框探针：补装（组 5 重载后同样补装）
    await ev(`(() => { window.__nativeDialogs = []; for (const k of ['alert','confirm','prompt']) { window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; } return true })()`);
    await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[1]}"]')`, 8000);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('她没有回头')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);

    const doc = () => ev(`document.querySelector('.ProseMirror').textContent`);
    const count = async (s) => (await doc()).split(s).length - 1;
    const typeInComposer = async (text) => {
      await app.clickEl(`document.querySelector('textarea[aria-label="AI 指令"]')`);
      await app.press("a", { ctrl: true });
      await app.press("Backspace");
      if (text) await app.typeText(text);
      await sleep(150);
    };
    const waitIdle = async () => {
      await sleep(150);
      await waitFor(ev, `!document.querySelector('button[aria-label="停止生成"]')`, 10000);
      await sleep(150);
    };
    const mode = async (label) => {
      await app.clickEl(`[...document.querySelectorAll('[role="radio"]')].find(b => b.textContent === '${label}')`);
      await sleep(100);
    };
    const lastReply = `[...document.querySelectorAll('[data-reply]')].at(-1)`;
    const menuItem = async (text) => {
      await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes(${JSON.stringify(text)}))`);
      await sleep(200);
    };
    const replyMore = async () => {
      await app.clickEl(`${lastReply}.querySelector('button[aria-label="更多"]')`);
      await sleep(150);
    };
    // 正文里把 DOM 光标放进某段（或末尾）并聚焦编辑器
    const caretIn = (needle, atEnd = true) =>
      ev(`(() => { const ed = document.querySelector('.ProseMirror'); const p = ${needle ? `[...ed.querySelectorAll('p')].find(x => x.textContent.includes(${JSON.stringify(needle)}))` : "ed"}; ed.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(!${atEnd}); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`);
    const send = async (text) => {
      await typeInComposer(text);
      await app.press("Enter");
      await waitIdle();
    };

    // ================= 组 1 上下文 =================
    await app.clickEl(`document.querySelector('button[aria-label="记忆与规则"]')`);
    await waitFor(ev, `!!document.querySelector('[data-testid="memory-book"]')`);
    const fill = async (sel, text) => {
      await app.clickEl(`document.querySelector('${sel}')`);
      await app.press("a", { ctrl: true });
      await app.typeText(text);
      await sleep(100);
    };
    await fill('[data-testid="memory-book"]', "全书基调：冷峻克制");
    await fill('[data-testid="memory-chapter"]', "这段要虐");
    await app.clickEl(`[...document.querySelectorAll('[data-testid="memory-rules"] button')].find(b => b.textContent.includes('新建规则'))`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="规则内容"]')`);
    await fill('textarea[aria-label="规则内容"]', "对话一律用「」");
    await app.clickEl(`document.querySelector('[data-testid="memory-book"]')`); // 失焦即存
    await sleep(400);
    await app.clickEl(`document.querySelector('button[aria-label="记忆与规则"]')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);
    await mode("写正文");
    await caretIn("她没有回头");
    await send("写一段");
    const r1 = mock.lastRequest();
    const sys1 = r1.messages[0].content;
    const user1 = r1.messages.at(-1).content;
    check("常驻记忆进 system", sys1.includes("全书基调：冷峻克制"), sys1.slice(0, 80));
    check("写作规则进 system", sys1.includes("对话一律用「」"));
    check("作者注在写作指令之前", user1.includes("这段要虐") && user1.indexOf("这段要虐") < user1.lastIndexOf("写一段"), user1.slice(-60));
    check("对 AI 隐藏的人物卡不注入（防剧透）；未隐藏的照常", !sys1.includes("敌国公主") && sys1.includes("守渡口的冷面剑客"));
    await app.clickEl(`document.querySelector('button[aria-label="上下文预览"]')`);
    await waitFor(ev, `!!document.querySelector('[data-testid="budget-bar"]')`, 5000);
    const preview = await ev(`document.querySelector('main').innerText`);
    check("上下文预览：预算条 + 槽位来由", preview.includes("常驻记忆") && preview.includes("作者注"));
    await app.screenshot(`${SHOTS}/context-preview.png`);
    await app.clickEl(`document.querySelector('button[aria-label="上下文预览"]')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);

    // ================= 组 2 生成 =================
    // 多候选 ×2
    await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.getAttribute('data-tip')?.startsWith('多候选'))`);
    await menuItem("2 版并排");
    await send("再写一段");
    await waitFor(ev, `document.querySelector('[data-candidates]')?.getAttribute('data-candidates') === '2'`, 10000);
    check("多候选：2 版并排", true);
    await app.screenshot(`${SHOTS}/candidates.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-candidates] button')].find(b => b.textContent === '用这版')`);
    await sleep(300);
    await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.getAttribute('data-tip')?.startsWith('多候选'))`);
    await menuItem("单版");
    // 带要求重试
    await send("写一小段");
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="带要求重新生成"]')`);
    await menuItem("更短");
    await waitIdle();
    check("重试「更短」：要求进写作指令", mock.lastRequest().messages.at(-1).content.includes("短"));
    check("回答旁有字数与 token 估算", /字 · ~\d+ tokens/.test(await ev(`${lastReply}.innerText`)));
    // 走向
    await mode("讨论");
    await typeInComposer("/走向");
    await waitFor(ev, `!!document.querySelector('[role="listbox"][aria-label="命令"] [role="option"]')`);
    await app.press("Enter");
    await sleep(300);
    if (await ev(`!!document.querySelector('textarea[aria-label="AI 指令"]').value.trim() && !document.querySelector('button[aria-label="停止生成"]')`)) await app.press("Enter");
    await waitIdle();
    await waitFor(ev, `document.querySelector('[data-directions]')?.getAttribute('data-directions') === '3'`, 8000);
    await app.clickEl(`[...document.querySelectorAll('[data-directions] button')].filter(b => b.textContent === '按这条写')[1]`);
    await waitIdle();
    check("走向：三条可点，「按这条写」发写正文请求", mock.lastRequest().messages.at(-1).content.includes("林晚负伤躲进旧城"));
    // 压缩
    await mode("讨论");
    await typeInComposer("/压缩");
    await waitFor(ev, `!!document.querySelector('[role="listbox"][aria-label="命令"] [role="option"]')`);
    await app.press("Enter");
    await sleep(300);
    if (await ev(`!!document.querySelector('textarea[aria-label="AI 指令"]').value.trim() && !document.querySelector('button[aria-label="停止生成"]')`)) await app.press("Enter");
    await waitIdle();
    await waitFor(ev, `!!document.querySelector('[data-compact-summary]')`, 8000);
    await send("那接下来呢？");
    const hist = mock.lastRequest().messages.slice(1, -1).map((m) => m.content);
    check("压缩后只带摘要：之前的回答不再发送", hist.some((c) => c.includes("沈砚守渡口")) && !hist.some((c) => c.includes("夜雨初歇")), `history=${hist.length}`);

    // ================= 组 3 会话 =================
    // 收藏 → 素材库
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="收藏到素材库"]')`);
    await waitFor(ev, `!!${lastReply}.querySelector('button[aria-label="取消收藏"]')`);
    const newMats = (await app.invoke("materials_list", { query: null })).filter((m) => !materialsBefore.has(m.id));
    check("收藏：素材库「AI 收藏」多一条", newMats.length === 1 && newMats[0].category === "AI 收藏", JSON.stringify(newMats.map((m) => m.title)));
    // 存为本章梗概
    await replyMore();
    await menuItem("存为本章梗概");
    await sleep(400);
    const ch2 = (await app.invoke("list_chapters", { bookId: book.id })).find((c) => c.id === ids[1]);
    check("存为本章梗概", ch2.synopsis.includes("沈砚守渡口") || ch2.synopsis.includes("节奏"), ch2.synopsis.slice(0, 30));
    // 抽取为情节块
    await replyMore();
    await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('抽取为'))`);
    await sleep(250);
    await menuItem("情节块");
    await waitFor(ev, `!!document.querySelector('[data-testid="extract-dialog"]')`, 8000);
    await app.screenshot(`${SHOTS}/extract.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-testid="extract-dialog"] button')].find(b => b.textContent.startsWith('创建'))`);
    await sleep(500);
    const plots = await app.invoke("plot_blocks_list", { bookId: book.id });
    check("抽取为情节块：勾选确认后落成卡片", plots.some((p) => p.content === "雪夜渡口初遇") && plots.some((p) => p.content === "旧城灯会交换地图"), `${plots.length} 张`);
    // 分叉
    const sessionsBefore = (await app.invoke("list_sessions", { chapterId: ids[1] })).length;
    await replyMore();
    await menuItem("从这里分叉为新对话");
    await sleep(600);
    const afterFork = await app.invoke("list_sessions", { chapterId: ids[1] });
    check("分叉：多一个「（分叉）」会话并切过去", afterFork.length === sessionsBefore + 1 && afterFork.some((s) => s.title.includes("分叉")));
    check("分叉会话带着到分叉点为止的对话", (await ev(`document.querySelectorAll('[data-reply]').length`)) >= 3);
    // 置顶 / 归档
    const forked = afterFork.find((s) => s.title.includes("分叉"));
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    await menuItem("归档本对话");
    await sleep(500);
    const arch = (await app.invoke("list_sessions", { chapterId: ids[1] })).find((s) => s.id === forked.id);
    check("归档：当前会话归档并切到另一个", arch.archived === true);
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    await sleep(200);
    check("会话菜单出现「已归档（1）」", await ev(`[...document.querySelectorAll('[role="menuitem"]')].some(b => b.textContent.includes('已归档（1）'))`));
    await menuItem("置顶本对话");
    await sleep(400);
    const pinned = await app.invoke("list_sessions", { chapterId: ids[1] });
    check("置顶：排到列表最前", pinned[0].pinned === true);
    // 全书搜索 → 跳到别章的会话
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[2]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('雪夜无声')`);
    await sleep(400);
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    await menuItem("搜索全书对话");
    await waitFor(ev, `!!document.querySelector('input[aria-label="搜索全书对话"]')`);
    await app.typeText("明显不同的走向");
    await waitFor(ev, `!!document.querySelector('[data-session-hit]')`, 5000);
    await app.screenshot(`${SHOTS}/search.png`);
    await app.clickEl(`document.querySelector('[data-session-hit]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('她没有回头')`, 5000);
    await sleep(500);
    check("搜索结果跳转：切回第二章并打开命中的会话", await ev(`[...document.querySelectorAll('[data-reply]')].some(r => r.innerText.includes('林晚负伤'))`));
    // 最大化
    const h0 = await ev(`document.querySelector('.panel-aidock').getBoundingClientRect().height`);
    await app.clickEl(`document.querySelector('button[aria-label="最大化 AI 卡"]')`);
    await sleep(400);
    const h1 = await ev(`document.querySelector('.panel-aidock').getBoundingClientRect().height`);
    await app.clickEl(`document.querySelector('button[aria-label="还原 AI 卡"]')`);
    await sleep(400);
    const h2 = await ev(`document.querySelector('.panel-aidock').getBoundingClientRect().height`);
    check("最大化 AI 卡并能还原到原高度", h1 > h0 * 1.6 && Math.abs(h2 - h0) < 8, `${Math.round(h0)} → ${Math.round(h1)} → ${Math.round(h2)}`);

    // ================= 组 4 采纳 =================
    await app.clickEl(`document.querySelector('button[aria-label="新对话"]')`);
    await sleep(500);
    // 逐段取舍：选中三段 → 润色 → 替换选区 → 拒第二处
    await ev(`(() => { const ed = document.querySelector('.ProseMirror'); const ps = [...ed.querySelectorAll('p')]; const a = ps.find(x => x.textContent.startsWith('逐段核验甲')); const c = ps.find(x => x.textContent.startsWith('逐段核验丙')); const r = document.createRange(); r.setStart(a.firstChild, 0); r.setEnd(c.firstChild, c.firstChild.length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); ed.focus(); return true })()`);
    await sleep(400);
    await waitFor(ev, `!!document.querySelector('[data-bubble-menu]')`, 4000);
    await app.clickEl(`[...document.querySelectorAll('[data-bubble-menu] button')].find(b => b.textContent === '润色')`);
    await waitIdle();
    await sleep(1200); // 等自动保存落盘，磁盘正文 = 采纳前的正文
    const preAdopt = (await app.invoke("read_chapter", { id: ids[1] })).content.trim();
    await app.clickEl(`[...${lastReply}.querySelectorAll('button')].find(b => b.textContent.includes('替换选区'))`);
    await waitFor(ev, `!!document.querySelector('[data-testid="diff-review"]')`);
    check("差异预览按段切成 2 处改动（不改的段不成块）", (await ev(`document.querySelectorAll('[data-hunk]').length`)) === 2);
    await app.clickEl(`document.querySelectorAll('[data-testid="diff-review"] button[aria-label="这处保留原文"]')[1]`);
    await sleep(150);
    await app.screenshot(`${SHOTS}/para-diff.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-testid="diff-review"] button')].find(b => b.textContent.startsWith('应用'))`);
    await waitFor(ev, `document.querySelector('.ProseMirror').textContent.includes('逐段核验甲：改稿')`);
    const d1 = await doc();
    check("逐段取舍：采用第一处、第三处保留原文、中间段不动", d1.includes("逐段核验甲：改稿") && d1.includes("逐段核验丙：原稿") && d1.includes("逐段核验乙：这一段不需要改"));
    // 检查点：版本历史里能找回采纳前的原文（与最近快照相同时强制快照是 no-op，原文本就已在历史里）
    const snaps = await app.invoke("list_history", { chapterId: ids[1] });
    const snapTexts = await Promise.all(snaps.slice(0, 5).map((s) => app.invoke("read_history", { chapterId: ids[1], file: s.file })));
    check("采纳前的原文在版本历史里（检查点）", snapTexts.some((t) => t.trim() === preAdopt), `${snaps.length} 版`);
    // AI 着色：改过的段落标底色；改一个字即消失
    await waitFor(ev, `[...document.querySelectorAll('.ProseMirror .ai-text')].some(e => e.textContent.includes('改稿'))`, 4000);
    check("AI 写入的段落淡淡标底色", true);
    check("着色片段按章存进设置", (await app.invoke("setting_get", { key: `ai_tint:${ids[1]}` }))?.includes("改稿"));
    await app.screenshot(`${SHOTS}/tint.png`);
    // 恢复到采纳之前
    await app.clickEl(`${lastReply}.querySelector('[data-restore-checkpoint]')`);
    await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent === '恢复')`);
    await waitFor(ev, `document.querySelector('.ProseMirror').textContent.includes('逐段核验甲：原稿')`);
    check("恢复到采纳之前：正文回到采纳前", !(await doc()).includes("改稿"));
    // 只采纳选中部分
    await mode("写正文");
    await caretIn("她没有回头");
    await send("写一段");
    const before18 = { part: await count("沈砚把斗篷裹紧了些"), rest: await count("渡口的灯笼次第亮起") };
    await ev(`(() => { const rep = ${lastReply}; const w = document.createTreeWalker(rep, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const i = n.data.indexOf('沈砚把斗篷裹紧了些'); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 9); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true } } return false })()`);
    await waitFor(ev, `!!${lastReply}.querySelector('[data-partial]')`, 3000);
    check("回答里划选 → 提示「只采纳选中的 N 字」", (await ev(`${lastReply}.querySelector('[data-partial]').textContent`)).includes("9 字"));
    await app.clickEl(`[...${lastReply}.querySelectorAll('button')].find(b => b.textContent.includes('插入光标处'))`);
    await sleep(500);
    check("只采纳选中部分：正文只多了选中的那句", (await count("沈砚把斗篷裹紧了些")) === before18.part + 1 && (await count("渡口的灯笼次第亮起")) === before18.rest);
    // Alt+K 就地改写（光标在段内 = 整段）
    await caretIn("逐段核验丙", false);
    await sleep(200);
    await app.press("k", { alt: true });
    await waitFor(ev, `!!document.querySelector('[data-inline-ai="edit"]')`, 3000);
    check("Alt+K：待改段高亮", await ev(`!!document.querySelector('.ProseMirror .ai-pending')`));
    await app.typeText("更有画面感");
    await app.press("Enter");
    await waitFor(ev, `document.querySelector('[data-inline-ai]')?.getAttribute('data-status') === 'done'`, 8000);
    check("就地改写请求：选中段 + 要求，不进对话历史", mock.lastRequest().messages.at(-1).content.includes("【选中段落】\n逐段核验丙") && mock.lastRequest().messages.at(-1).content.includes("更有画面感"));
    await app.screenshot(`${SHOTS}/inline-edit.png`);
    await app.press("Enter");
    await waitFor(ev, `document.querySelector('.ProseMirror').textContent.includes('逐段核验丙：改稿')`, 4000);
    check("Alt+K → Enter 应用：只改了这一段", (await doc()).includes("逐段核验甲：原稿") && !(await ev(`!!document.querySelector('[data-inline-ai]')`)));
    // Alt+Enter 续写浮条
    const before20 = await count("渡口的灯笼次第亮起");
    await caretIn("她没有回头");
    await sleep(200);
    await app.press("Enter", { alt: true });
    await waitFor(ev, `document.querySelector('[data-inline-ai="continue"]')?.getAttribute('data-status') === 'done'`, 8000);
    await app.screenshot(`${SHOTS}/continue.png`);
    await app.press("Enter");
    await sleep(500);
    check("Alt+Enter 续写：浮条预览 → Enter 插到光标处", (await count("渡口的灯笼次第亮起")) === before20 + 1);
    // Esc 丢弃
    await caretIn("她没有回头");
    await app.press("Enter", { alt: true });
    await waitFor(ev, `!!document.querySelector('[data-inline-ai="continue"]')`, 3000);
    await app.press("Escape");
    await sleep(300);
    check("Esc 丢弃浮条、正文不变", !(await ev(`!!document.querySelector('[data-inline-ai]')`)) && (await count("渡口的灯笼次第亮起")) === before20 + 1);
    // 着色开关
    await app.clickEl(`document.querySelector('.ProseMirror').closest('.relative').querySelector('button[aria-label="更多"]')`);
    await menuItem("标出 AI 写入的文字");
    await sleep(200);
    check("关掉「标出 AI 写入的文字」→ 底色全消", (await ev(`document.querySelectorAll('.ProseMirror .ai-text').length`)) === 0);
    // 统计 / 磁盘
    await sleep(1200);
    const disk = (await app.invoke("read_chapter", { id: ids[1] })).content;
    check("就地改写与续写已自动保存到磁盘", disk.includes("逐段核验丙：改稿") && disk.includes("渡口的灯笼次第亮起"));
    check("全程没有原生对话框", (await ev(`window.__nativeDialogs.length`)) === 0);

    // ================= 组 5 agent 工具调用（假 ACP agent；agent 登记由 withGuard 还原） =================
    const AGENT = { id: "mock-acp", name: "核验假 Agent", command: process.execPath, args: [fileURLToPath(new URL("./mock-acp.mjs", import.meta.url))], enabled: true, is_default: false, last_probe: null };
    await app.invoke("agents_upsert", { desc: AGENT });
    await app.invoke("agents_set_default", { id: AGENT.id });
    await ev(`localStorage.setItem('bixian.chat.backend', 'agent:${AGENT.id}'); true`);
    await app.reload();
    await ev(`(() => { window.__nativeDialogs = []; for (const k of ['alert','confirm','prompt']) { window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; } return true })()`);
    await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[0]}"]')`, 8000);
    await app.clickEl(`document.querySelector('[data-chapter-row="${ids[0]}"]')`);
    await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('沈砚站在船头')`);
    await waitFor(ev, `!!document.querySelector('textarea[aria-label="AI 指令"]')`);
    const agentIdle = async () => {
      await sleep(300);
      await waitFor(ev, `!document.querySelector('button[aria-label="停止生成"]')`, 20000);
      await sleep(400);
    };
    await typeInComposer("【改文件】给第一章补一段");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('[data-permission-card]')`, 20000);
    check("agent 请求权限：弹卡并标出类别「编辑」", (await ev(`document.querySelector('[data-permission-card]').innerText`)).includes("编辑"));
    await app.screenshot(`${SHOTS}/agent-permission.png`);
    await app.clickEl(`[...document.querySelectorAll('[data-permission-card] button')].find(b => b.textContent === '允许')`);
    await agentIdle();
    await waitFor(ev, `!!${lastReply}.querySelector('[data-agent-changes]')`, 10000);
    check("工具调用默认折叠成一行「调用了 2 个工具」", (await ev(`${lastReply}.querySelector('[data-agent-tools]').getAttribute('data-agent-tools')`)) === "2");
    check("回合文件改动：3 个（改第一章、新章、设定笔记）", (await ev(`${lastReply}.querySelector('[data-agent-changes]').getAttribute('data-agent-changes')`)) === "3");
    await waitFor(ev, `document.querySelector('.ProseMirror').textContent.includes('AI 补写的一段')`, 5000);
    check("打开着的章自动刷新为 agent 改后的正文", true);
    const titles = async () => (await app.invoke("list_chapters", { bookId: book.id })).map((c) => c.title);
    check("agent 新建的章文件进了目录", (await titles()).some((t) => t.includes("AI新章")));
    await app.clickEl(`${lastReply}.querySelector('button[aria-label="展开工具调用"]')`);
    await sleep(200);
    check("展开：每一步的类别、状态与增删行数", await ev(`(() => { const t = ${lastReply}.querySelector('[data-agent-tools]').innerText; return t.includes('改写 第一章') && t.includes('读取') && t.includes('+') })()`));
    await app.screenshot(`${SHOTS}/agent-tools.png`);
    // 全部撤销 → 恢复
    await app.clickEl(`[...${lastReply}.querySelectorAll('[data-agent-changes] button')].find(b => b.textContent.includes('撤销全部改动'))`);
    await waitFor(ev, `${lastReply}.querySelector('[data-agent-changes]')?.getAttribute('data-undone') === '1'`, 8000);
    await waitFor(ev, `!document.querySelector('.ProseMirror').textContent.includes('AI 补写的一段')`, 5000);
    check("撤销全部改动：正文回到 agent 改之前，新建的章移进回收站", !(await titles()).some((t) => t.includes("AI新章")) && !(await app.invoke("read_chapter", { id: ids[0] })).content.includes("AI 补写"));
    await app.clickEl(`[...${lastReply}.querySelectorAll('[data-agent-changes] button')].find(b => b.textContent.includes('恢复 AI 改动'))`);
    await waitFor(ev, `${lastReply}.querySelector('[data-agent-changes]')?.getAttribute('data-undone') === '0'`, 8000);
    await waitFor(ev, `document.querySelector('.ProseMirror').textContent.includes('AI 补写的一段')`, 5000);
    check("恢复 AI 改动：正文与新章都回来（新章从回收站还原）", (await titles()).some((t) => t.includes("AI新章")));
    // 本会话一直允许
    await typeInComposer("【再改】");
    await app.press("Enter");
    await waitFor(ev, `!!document.querySelector('[data-permission-card]')`, 20000);
    await app.clickEl(`[...document.querySelectorAll('[data-permission-card] button')].find(b => b.textContent.includes('本会话一直允许'))`);
    await agentIdle();
    await typeInComposer("【再改】");
    await app.press("Enter");
    let cardSeen = false;
    for (let i = 0; i < 40 && (await ev(`!!document.querySelector('button[aria-label="停止生成"]')`)); i++) {
      if (await ev(`!!document.querySelector('[data-permission-card]')`)) cardSeen = true;
      await sleep(150);
    }
    await agentIdle();
    const again = await count("AI 又补了一句");
    check("「本会话一直允许」后同类请求不再弹卡、直接执行", !cardSeen && again === 2, `弹卡=${cardSeen} 补句=${again}`);
    await app.clickEl(`document.querySelector('button[aria-label="切换对话"]')`);
    await sleep(200);
    check("会话菜单可清除自动允许", await ev(`[...document.querySelectorAll('[role="menuitem"]')].some(b => b.textContent.includes('清除自动允许（编辑）'))`));
    await menuItem("清除自动允许");
    check("全程没有原生对话框（agent 段）", (await ev(`(window.__nativeDialogs ?? []).length`)) === 0);
    await app.screenshot(`${SHOTS}/final.png`);
    return summary();
  } finally {
    await app.invoke("delete_provider", { id: provider.id }).catch(() => {});
    if (prevActive != null) await app.invoke("set_active_provider", { id: prevActive }).catch(() => {});
    await mock.close();
  }
});
