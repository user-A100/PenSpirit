// 阶段 3A 实机核验：Binder 交互 + 组视图 + 顺序落盘（Markdown 真源）。
// 多选 3 章 Pointer 拖到首位 → 磁盘文件序号与 DB 一致 → 关闭重启 → 「从磁盘重建索引」后顺序不变（其他书不受影响）；
// F2 改名同步文件名；Del 后 Toast 撤销；Ctrl+2 卡片墙拖动换序 → 侧栏同步；分屏各记一份组模式；
// 键盘 ↓ / Shift+↓ / Ctrl+↑；过滤（拼音首字母）；拖到集合标签 = 加入；拖进正文 = [[章题]]；定位当前章。
// 用法（应用已带调试端口启动）：node scripts/verify/p3a.mjs
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";

const SHOTS = ".tmp-verify/p3a";
const LIB = join(process.env.APPDATA ?? "", "com.bixian.app", "library");
const DIALOG_PROBE = `(() => { window.__nativeDialogs = window.__nativeDialogs ?? []; for (const k of ['alert','confirm','prompt']) { window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; } return true; })()`;

await withGuard("p3a", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = (x) => app.evaluate(x);
  const T = ["风起", "雪落", "渡口", "旧城", "灯会", "尾声"];

  // 其他书的章节快照（重建索引不得改动它们）
  const snapshotOthers = async (exclude) => {
    const out = {};
    for (const b of await app.invoke("list_books")) {
      if (b.id === exclude) continue;
      out[b.id] = (await app.invoke("list_chapters", { bookId: b.id })).map((c) => `${c.id}|${c.title}|${c.file_path}|${c.sort_key}`);
    }
    return JSON.stringify(out);
  };

  const { book, ids } = await makeBook("阶段三A", T.map((t) => [t, `${t}的正文。灯影摇晃。`]));
  const others0 = await snapshotOthers(book.id);
  const byTitle = Object.fromEntries(T.map((t, i) => [t, ids[i]]));

  const rowsUI = () => ev(`[...document.querySelectorAll('[data-chapter-row]')].map(r => r.querySelector('span.truncate')?.textContent)`);
  const dbTitles = async () => (await app.invoke("list_chapters", { bookId: book.id })).map((c) => c.title);
  /** 磁盘 manuscript 文件名（排序）与 DB 目录序下的文件名逐一相同，且每个文件正文对得上标题 */
  const diskConsistent = async () => {
    const chs = await app.invoke("list_chapters", { bookId: book.id });
    const names = chs.map((c) => c.file_path.split("/").pop());
    const disk = readdirSync(join(LIB, book.slug, "manuscript")).filter((n) => n.endsWith(".md")).sort();
    const bodiesOk = chs.every((c) => readFileSync(join(LIB, c.file_path), "utf8").includes("的正文"));
    return { ok: JSON.stringify(names) === JSON.stringify(disk) && bodiesOk, names, disk };
  };
  const rowBox = (title) =>
    ev(`(() => { const r = [...document.querySelectorAll('[data-chapter-row]')].find(r => r.querySelector('span.truncate')?.textContent === ${JSON.stringify(title)}); if (!r) return null; r.scrollIntoView({block:'nearest'}); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom } })()`);
  const mouse = (type, x, y, modifiers = 0) =>
    app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers });
  const clickRow = async (title, { ctrl = false, shift = false } = {}) => {
    const p = await rowBox(title);
    if (!p) throw new Error(`找不到行：${title}`);
    const m = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    await mouse("mousePressed", p.x, p.y, m);
    await mouse("mouseReleased", p.x, p.y, m);
    await sleep(200);
  };
  /** 真实 Pointer 拖拽（CDP 鼠标事件 → Chromium 指针管线），midCheck 在松手前执行 */
  const drag = async (from, to, midCheck) => {
    await mouse("mousePressed", from.x, from.y);
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps, button: "left", buttons: 1 });
      await sleep(16);
    }
    await sleep(80);
    const mid = midCheck ? await midCheck() : null;
    await mouse("mouseReleased", to.x, to.y);
    await sleep(400);
    return mid;
  };
  const current = () => ev(`document.querySelector('[data-chapter-row][aria-current="true"] span.truncate')?.textContent ?? null`);
  const openBook = async () => {
    await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.nav.view', 'write'); true`);
    await app.reload();
    try {
      await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[0]}"]')`, 4000);
    } catch {
      await app.press("b", { ctrl: true }); // 侧栏若是折叠的，展开
      await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[0]}"]')`, 6000);
    }
  };

  await openBook();
  check("侧栏 Binder 列出 6 章（目录序）", JSON.stringify(await rowsUI()) === JSON.stringify(T));

  // ① 多选：点「旧城」→ Shift 点「尾声」= 3 章；活动窗格切到组视图
  await clickRow("旧城");
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('旧城的正文')`);
  await clickRow("尾声", { shift: true });
  const sel = await ev(`[...document.querySelectorAll('[data-chapter-row][aria-selected="true"]')].map(r => r.querySelector('span.truncate').textContent)`);
  check("Shift 连选 3 章", JSON.stringify(sel) === JSON.stringify(["旧城", "灯会", "尾声"]), sel.join("、"));
  const gv = await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.innerText.includes('已选 3 章') && document.querySelector('[data-testid="group-view"]').dataset.groupMode`);
  check("多选 → 编辑区切到组视图（偏好模式）", !!gv, gv);
  await app.screenshot(`${SHOTS}/1-multiselect-group.png`);

  // ② Pointer 拖到首位：插入线 + 幽灵标签「3 章」；落下后 UI / DB / 磁盘一致
  const from = await rowBox("灯会");
  const first = await rowBox("风起");
  const mid = await drag(from, { x: first.x, y: first.top + 3 }, () =>
    ev(`({ line: !!document.querySelector('[data-drop-line]'), ghost: document.querySelector('[data-drag-ghost]')?.innerText ?? '' })`),
  );
  await app.screenshot(`${SHOTS}/2-after-drag.png`);
  check("拖拽中显示插入线与「3 章」幽灵标签", mid.line && mid.ghost.includes("3 章"), JSON.stringify(mid));
  const expected1 = ["旧城", "灯会", "尾声", "风起", "雪落", "渡口"];
  await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row]')].map(r => r.querySelector('span.truncate').textContent).join() === ${JSON.stringify(expected1.join())}`);
  check("多选聚拢拖到首位：侧栏顺序", true, expected1.join("、"));
  check("DB 目录序一致", JSON.stringify(await dbTitles()) === JSON.stringify(expected1));
  let disk = await diskConsistent();
  check("磁盘文件序号与 DB 目录序一致（0001-旧城 …）", disk.ok && disk.names[0].startsWith("0001-旧城"), disk.names.join(" "));

  // ③ 关闭重启 → 从磁盘重建索引 → 顺序不变、其他书不动
  await app.restart();
  await ev(DIALOG_PROBE);
  try {
    await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[0]}"]')`, 6000);
  } catch {
    await openBook();
  }
  check("重启后顺序不变", JSON.stringify(await rowsUI()) === JSON.stringify(expected1));
  await app.clickEl(`document.querySelector('[data-book-switcher]')`);
  await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.includes('从磁盘重建索引'))`);
  await waitFor(ev, `document.body.innerText.includes('已从磁盘重建索引')`);
  check("重建索引后顺序不变（UI + DB）", JSON.stringify(await rowsUI()) === JSON.stringify(expected1) && JSON.stringify(await dbTitles()) === JSON.stringify(expected1));
  check("重建索引未改动其他书", (await snapshotOthers(book.id)) === others0);

  // ④ F2 改名：文件名同步、序号不变
  await clickRow("风起");
  await app.press("F2");
  await waitFor(ev, `!!document.querySelector('input[aria-label="新名称"]')`);
  await app.press("a", { ctrl: true });
  await app.typeText("风起时");
  await app.press("Enter");
  await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row] span.truncate')].some(s => s.textContent === '风起时')`);
  const renamed = (await app.invoke("list_chapters", { bookId: book.id })).find((c) => c.id === byTitle["风起"]);
  disk = await diskConsistent();
  check("F2 改名同步文件名（序号保留）", renamed.title === "风起时" && renamed.file_path.endsWith("0004-风起时.md") && disk.ok, renamed.file_path);
  const expected2 = ["旧城", "灯会", "尾声", "风起时", "雪落", "渡口"];

  // ⑤ Del → Toast 撤销：回到原位，磁盘一致
  await clickRow("雪落");
  await app.press("Delete");
  await waitFor(ev, `![...document.querySelectorAll('[data-chapter-row] span.truncate')].some(s => s.textContent === '雪落')`);
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '撤销')`);
  await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row]')].map(r => r.querySelector('span.truncate').textContent).join() === ${JSON.stringify(expected2.join())}`);
  disk = await diskConsistent();
  check("Del 后 Toast 撤销：回到原位、磁盘一致", disk.ok, disk.names.join(" "));

  // ⑥ Ctrl+2 卡片墙（整本书）拖动换序 → 侧栏同步
  await clickRow("旧城");
  await app.press("2", { ctrl: true, code: "Digit2" });
  await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.dataset.groupMode === 'corkboard' && document.querySelectorAll('[data-card]').length === 6`);
  await app.screenshot(`${SHOTS}/3-corkboard.png`);
  const card = (t) => `document.querySelector('[data-card="${byTitle[t]}"]')`;
  await ev(`(() => { window.__dt = new DataTransfer(); ${card("渡口")}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: window.__dt })); return true })()`);
  await sleep(60);
  await ev(`${card("旧城")}.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(60);
  await ev(`${card("旧城")}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__dt }))`);
  await sleep(60);
  await ev(`${card("渡口")}.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: window.__dt }))`);
  const expected3 = ["渡口", "旧城", "灯会", "尾声", "风起时", "雪落"];
  const synced = await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row]')].map(r => r.querySelector('span.truncate').textContent).join() === ${JSON.stringify(expected3.join())}`).catch(() => false);
  disk = await diskConsistent();
  check("卡片墙拖动换序 → 侧栏同步 + 磁盘一致", !!synced && disk.ok, (await rowsUI()).join("、"));
  await app.press("2", { ctrl: true, code: "Digit2" });
  check("再按 Ctrl+2 回到单章正文", await waitFor(ev, `!document.querySelector('[data-testid="group-view"]') && !!document.querySelector('.ProseMirror')`));
  await app.press("1", { ctrl: true, code: "Digit1" });
  const scriv = await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.dataset.groupMode === 'scrivenings' && document.querySelector('[data-testid="group-view"]').innerText.includes('风起的正文')`).catch(() => false);
  check("Ctrl+1 串烧：全书连读", !!scriv);
  await app.press("3", { ctrl: true, code: "Digit3" });
  const outl = await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.dataset.groupMode === 'outliner' && document.querySelector('[data-testid="group-view"]').innerText.includes('共 6 章')`).catch(() => false);
  check("Ctrl+3 大纲列：合计行", !!outl);
  await app.press("3", { ctrl: true, code: "Digit3" });

  // ⑦ 分屏各记一份：开左右分屏，活动窗格 Ctrl+2，另一窗格仍是正文
  const split0 = await ev(`document.querySelectorAll('[data-pane]').length`);
  await app.press("s", { alt: true });
  await waitFor(ev, `document.querySelectorAll('[data-pane]').length === 2`);
  await app.press("2", { ctrl: true, code: "Digit2" });
  const panes = await waitFor(ev, `(() => { const p = [...document.querySelectorAll('[data-pane]')]; const g = p.map(x => !!x.querySelector('[data-testid="group-view"]')); return g.filter(Boolean).length === 1 ? g : null })()`).catch(() => null);
  check("分屏：组模式只作用于活动窗格", !!panes, JSON.stringify(panes));
  await app.press("2", { ctrl: true, code: "Digit2" });
  // Alt+S 循环 无 → 左右 → 上下 → 无
  for (let i = 0; i < 3 && (await ev(`document.querySelectorAll('[data-pane]').length`)) !== split0; i++) {
    await app.press("s", { alt: true });
    await sleep(200);
  }

  // ⑧ 键盘：↓ 打开下一章、Shift+↓ 扩选、Ctrl+↑ 整体上移
  await clickRow("旧城");
  await app.press("ArrowDown");
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('灯会的正文')`);
  check("↓ 选中并打开下一章", (await current()) === "灯会");
  await app.press("ArrowDown", { shift: true });
  const sel2 = await ev(`document.querySelectorAll('[data-chapter-row][aria-selected="true"]').length`);
  check("Shift+↓ 扩选", sel2 === 2);
  await app.press("ArrowUp", { ctrl: true });
  const expected4 = ["渡口", "灯会", "尾声", "旧城", "风起时", "雪落"];
  const nudged = await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row]')].map(r => r.querySelector('span.truncate').textContent).join() === ${JSON.stringify(expected4.join())}`).catch(() => false);
  disk = await diskConsistent();
  check("Ctrl+↑ 选中两章整体上移（磁盘一致）", !!nudged && disk.ok, (await rowsUI()).join("、"));
  await app.press("Escape");
  await sleep(150);
  check("Esc 收拢多选", (await ev(`document.querySelectorAll('[data-chapter-row][aria-selected="true"]').length`)) === 1);

  // ⑨ 过滤：拼音首字母
  await app.clickEl(`document.querySelector('button[aria-label="过滤章节"]')`);
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '过滤章节关键词'`);
  await app.typeText("dk");
  await sleep(200);
  check("过滤：拼音首字母 dk → 渡口", JSON.stringify(await rowsUI()) === JSON.stringify(["渡口"]));
  await app.press("Escape");
  await sleep(150);
  check("Esc 清除过滤", (await rowsUI()).length === 6);

  // ⑩ 拖到集合标签 = 加入
  const col = await app.invoke("collection_upsert", { input: { id: null, book_id: book.id, name: "核验集合", kind: "manual", query: "" } });
  await app.reload();
  await waitFor(ev, `!!document.querySelector('[data-collection-tab="${col.id}"]')`, 8000);
  const tab = await ev(`(() => { const b = document.querySelector('[data-collection-tab="${col.id}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`);
  const hint = await drag(await rowBox("灯会"), tab, () => ev(`document.querySelector('[data-drag-ghost]')?.innerText ?? ''`));
  await sleep(500);
  const members = (await app.invoke("collection_chapters", { collectionId: col.id })).map((c) => c.title).join();
  check("拖到集合标签 = 加入集合", String(members).includes("灯会") && hint.includes("核验集合"), `${members} / ${hint}`);
  await app.clickEl(`document.querySelector('[data-collection-tab="${col.id}"]')`);
  await waitFor(ev, `[...document.querySelectorAll('[data-chapter-row] span.truncate')].map(s => s.textContent).join() === '灯会'`);
  await app.screenshot(`${SHOTS}/4-collection-scope.png`);
  check("集合标签页：列表 = 集合成员", true);
  await app.clickEl(`[...document.querySelectorAll('[role="tab"]')].find(t => t.textContent.includes('全书'))`);
  await waitFor(ev, `document.querySelectorAll('[data-chapter-row]').length === 6`);

  // ⑪ 拖进正文 = 插入 [[章题]]
  await clickRow("风起时");
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('风起的正文')`);
  const para = await ev(`(() => { const p = document.querySelector('.ProseMirror p'); const b = p.getBoundingClientRect(); return { x: b.right - 4, y: b.top + b.height / 2 } })()`);
  await drag(await rowBox("雪落"), para);
  const linked = await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('[[雪落]]')`).catch(() => false);
  check("从 Binder 拖进正文 → 插入 [[雪落]]", !!linked);
  await sleep(1500); // 等自动保存
  const savedBody = readFileSync(join(LIB, (await app.invoke("list_chapters", { bookId: book.id })).find((c) => c.title === "风起时").file_path), "utf8");
  check("链接已落盘", savedBody.includes("[[雪落]]"), savedBody.slice(0, 40));

  // ⑫ 定位当前章：过滤掉当前章后 Ctrl+Shift+E → 清过滤并聚焦当前章行
  await app.clickEl(`document.querySelector('button[aria-label="过滤章节"]')`);
  await app.typeText("灯会");
  await sleep(150);
  await app.press("e", { ctrl: true, shift: true });
  const revealed = await waitFor(ev, `document.activeElement?.getAttribute('data-chapter-row') === '${byTitle["风起"]}' && document.querySelectorAll('[data-chapter-row]').length === 6`).catch(() => false);
  check("Ctrl+Shift+E 在目录中定位当前章", !!revealed);

  const dialogs = await ev(`(window.__nativeDialogs ?? []).length`);
  check("全程无原生对话框", dialogs === 0);
  return summary();
});
