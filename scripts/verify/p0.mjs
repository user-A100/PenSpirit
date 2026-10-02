// 阶段 0 实机核验：错误文案 / 无原生对话框 / 行内改名同步磁盘 / Del 删除 + 撤销 / Ctrl+N 新建即命名。
// 用法（应用已带调试端口启动）：node scripts/verify/p0.mjs
import { existsSync } from "node:fs";
import { join } from "node:path";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";

const LIB = join(process.env.APPDATA, "com.bixian.app", "library");

await withGuard("p0", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const { book, ids } = await makeBook("阶段零", [
    ["甲章", "第一段。\n\n第二段。"],
    ["乙章", "乙章正文。"],
    ["丙章", "丙章正文。"],
  ]);
  const [jia, yi, bing] = ids;
  const ev = app.evaluate;

  // 进入写作视图并选中测试书 + 甲章
  await ev(`(async () => { document.querySelector('aside button[title="写作"]')?.click(); return true })()`);
  await app.reload();
  await ev(`(async () => { localStorage.setItem('bixian.lastBookId', '${book.id}'); return true })()`);
  await app.reload();
  await waitFor(ev, `!!document.querySelector('[data-chapter-row="${jia}"]')`, 8000);
  await app.clickEl(`document.querySelector('[data-chapter-row="${jia}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('第一段')`);

  // ① 未配服务商时发送：中文报错 + 去设置入口 + 无残留气泡
  const providers = await app.invoke("list_providers");
  const active = await app.invoke("get_active_provider");
  if (active == null) {
    // 阶段 2A 起的输入区：textarea[aria-label="AI 指令"]，Enter 发送
    await app.clickEl(`document.querySelector('textarea[aria-label="AI 指令"]')`);
    await app.typeText("核验：续写一句");
    await app.press("Enter");
    const err = await waitFor(ev, `document.querySelector('[role="alert"]')?.innerText`);
    check("未配服务商：报错为中文且非 [object Object]", err.includes("服务商") && !err.includes("object Object"), err);
    check("报错条带「去设置服务商」入口", await ev(`[...document.querySelectorAll('[role="alert"] button')].some(b => b.textContent.trim() === '去设置服务商')`));
    const bubbles = await ev(`[...document.querySelectorAll('body *')].filter(d => d.tagName !== 'TEXTAREA' && d.children.length === 0 && d.textContent.trim() === '核验：续写一句').length`);
    const restored = await ev(`document.querySelector('textarea[aria-label="AI 指令"]').value`);
    check("发送失败撤回乐观气泡、指令还回输入框（不出现两份）", bubbles === 0 && restored === "核验：续写一句", `气泡数 ${bubbles} / 输入框「${restored}」`);
    await ev(`(() => { const ta = document.querySelector('textarea[aria-label="AI 指令"]'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(ta, ''); ta.dispatchEvent(new Event('input', { bubbles: true })); return true })()`);
    await app.clickEl(`[...document.querySelectorAll('[role="alert"] button')].find(b => b.textContent.trim() === '去设置服务商')`);
    const tab = await waitFor(ev, `[...document.querySelectorAll('[data-testid="settings-backdrop"] button')].find(b => b.textContent.trim() === 'AI 服务商')?.className`);
    check("「去设置服务商」直达 AI 服务商 tab", /border-|text-\[color:var\(--accent/.test(tab) || tab.includes("accent"), "");
    await app.press("Escape");
    await sleep(200);
  } else {
    check("（跳过）本机已配服务商，未测未配置路径", true, `${providers.length} 个服务商`);
  }

  // ② 右键菜单 → 重命名 → 磁盘文件名与 DB 同步
  await app.clickEl(`document.querySelector('[data-chapter-row="${yi}"]')`, "right");
  await waitFor(ev, `!!document.querySelector('[role="menu"]')`);
  check("章节行右键弹出应用内菜单", true);
  await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.includes('重命名'))`);
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '新名称'`);
  await app.press("a", { ctrl: true });
  await app.typeText("乙章改名");
  await app.press("Enter");
  await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row]')].some(r => r.textContent.includes('乙章改名'))`);
  const afterRename = (await app.invoke("list_chapters", { bookId: book.id })).find((c) => c.id === yi);
  check("改名写入 DB 标题", afterRename.title === "乙章改名", afterRename.title);
  check("改名同步磁盘文件名", afterRename.file_path.includes("乙章改名") && existsSync(join(LIB, afterRename.file_path)), afterRename.file_path);

  // ③ F2 / Esc 取消不改名
  await app.clickEl(`document.querySelector('[data-chapter-row="${bing}"]')`);
  await ev(`document.querySelector('[data-chapter-row="${bing}"]').focus()`);
  await app.press("F2");
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '新名称'`);
  await app.typeText("不该生效");
  await app.press("Escape");
  await sleep(150);
  const bingTitle = (await app.invoke("list_chapters", { bookId: book.id })).find((c) => c.id === bing).title;
  check("F2 改名后 Esc 取消：标题不变", bingTitle === "丙章", bingTitle);

  // ④ Del 删除 → 回收站 → Toast 撤销 → 回到原位
  await ev(`document.querySelector('[data-chapter-row="${yi}"]').focus()`);
  await app.press("Delete");
  await waitFor(ev, `!document.querySelector('[data-chapter-row="${yi}"]')`);
  const trash = await app.invoke("list_trash", { bookId: book.id });
  check("Del 删除进回收站", trash.some((c) => c.id === yi));
  const toastText = await waitFor(ev, `document.querySelector('[data-testid="toast"]')?.textContent`);
  check("删除后出现带「撤销」的提示", toastText.includes("撤销"), toastText);
  await app.clickEl(`[...document.querySelectorAll('[data-testid="toast"] button')].find(b => b.textContent === '撤销')`);
  await waitFor(ev, `!!document.querySelector('[data-chapter-row="${yi}"]')`);
  const order = (await app.invoke("list_chapters", { bookId: book.id })).map((c) => c.id);
  check("撤销后章节回到原位置", JSON.stringify(order) === JSON.stringify([jia, yi, bing]), order.join(","));

  // ⑤ Ctrl+N：在当前章后新建并进入改名
  await app.clickEl(`document.querySelector('[data-chapter-row="${jia}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('第一段')`);
  await ev(`document.querySelector('.ProseMirror').focus()`);
  await app.press("n", { ctrl: true });
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '新名称'`, 6000);
  await app.press("a", { ctrl: true });
  await app.typeText("插入章");
  await app.press("Enter");
  await sleep(400);
  const list = await app.invoke("list_chapters", { bookId: book.id });
  const titles = list.map((c) => c.title);
  check("Ctrl+N 新章插在当前章之后并按输入命名", JSON.stringify(titles) === JSON.stringify(["甲章", "插入章", "乙章改名", "丙章"]), titles.join(" / "));

  // ⑥ Ctrl+B 全局快捷键在编辑器内也只折叠侧栏（不再同时加粗）
  await ev(`document.querySelector('.ProseMirror').focus()`);
  const html0 = await ev(`document.querySelector('.ProseMirror').innerHTML`);
  await app.press("b", { ctrl: true });
  await sleep(200);
  const collapsed = await ev(`!document.querySelector('[data-chapter-row]')`);
  await app.press("b", { ctrl: true });
  await sleep(200);
  const html1 = await ev(`document.querySelector('.ProseMirror')?.innerHTML ?? ''`);
  check("Ctrl+B 在编辑器内折叠侧栏且不改正文格式", collapsed && !html1.includes("<strong>") && html0.length > 0);

  // ⑦ 防抖窗口内切章：上一章最后的改动不丢（修复前会被静默丢弃）
  await app.clickEl(`document.querySelector('[data-chapter-row="${jia}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('第一段')`);
  await ev(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`);
  await app.typeText("切章前最后一句");
  await sleep(120); // 远小于 800ms 防抖
  await app.clickEl(`document.querySelector('[data-chapter-row="${bing}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('丙章正文')`);
  await sleep(1500);
  const jiaDisk = (await app.invoke("read_chapter", { id: jia })).content;
  const bingDisk = (await app.invoke("read_chapter", { id: bing })).content;
  check("防抖窗口内切章：上一章改动已落盘", jiaDisk.includes("切章前最后一句"), jiaDisk.slice(-20));
  check("且没有误写进新打开的章", !bingDisk.includes("切章前最后一句"));

  await app.screenshot(".tmp-verify/p0-final.png");
  const dialogs = await ev(`window.__nativeDialogs ?? []`);
  check("全程无原生 alert/confirm", dialogs.length === 0, dialogs.join("; "));
  return summary();
});
