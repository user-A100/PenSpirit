// 阶段 3B 实机核验：卷层级（卷 = manuscript/ 子目录）+ 拆分 / 合并。
// 导入含 3 卷的 txt → 侧栏三卷结构、磁盘子目录 → 指针拖一章进别的卷 → Ctrl+← / Ctrl+→ 升降级 →
// 关闭重启 + 从磁盘重建索引后结构不变 → AI 预览「上一章结尾」为跨卷前一章 → 选卷看组视图 / 聚焦单卷 →
// 光标处拆分 + 撤销 → 合并 + 撤销 → 删卷 + 撤销 → 新建卷 → 导出带卷名。
// 用法（应用已带调试端口启动）：node scripts/verify/p3b.mjs
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";

const SHOTS = ".tmp-verify/p3b";
const LIB = join(process.env.APPDATA ?? "", "com.bixian.app", "library");
const TMP = resolve(".tmp-verify/p3b-input");
mkdirSync(TMP, { recursive: true });
const DIALOG_PROBE = `(() => { window.__nativeDialogs = window.__nativeDialogs ?? []; for (const k of ['alert','confirm','prompt']) { window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; } return true; })()`;

await withGuard("p3b", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = (x) => app.evaluate(x);

  const snapshotOthers = async (exclude) => {
    const out = {};
    for (const b of await app.invoke("list_books")) {
      if (b.id === exclude) continue;
      out[b.id] = (await app.invoke("list_nodes", { bookId: b.id })).map((c) => `${c.id}|${c.title}|${c.file_path}|${c.sort_key}|${c.parent_id}`);
    }
    return JSON.stringify(out);
  };

  // ① 含 3 卷的 txt：预览识别卷 → 导入落成卷目录
  const txt = [
    "第一卷 风雪", "第一章 渡口", "渡口的灯笼次第亮起。", "第二章 旧城", "旧城灯会，林晚递来半张地图。",
    "第二卷 灯会", "第三章 夜市", "夜市人声鼎沸。", "第四章 别离", "她没有回头。",
    "第三卷 归途", "第五章 雪夜", "雪夜渡口。", "旧人归来。",
  ].join("\n\n");
  const file = join(TMP, "三卷样书.txt");
  writeFileSync(file, txt, "utf8");
  const parsed = await app.invoke("preview_import", { path: file });
  check("导入预览识别 3 卷 5 章", parsed.length === 5 && new Set(parsed.map((p) => p.volume)).size === 3, parsed.map((p) => `${p.volume}/${p.title}`).join(" "));
  const { book } = await makeBook("阶段三B", []);
  const others0 = await snapshotOthers(book.id);
  await app.invoke("import_chapters", { bookId: book.id, chapters: parsed });

  const nodes = () => app.invoke("list_nodes", { bookId: book.id });
  /** Node 侧轮询：fn() 为真即返回，超时返回 false（不抛） */
  const until = async (fn, timeout = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await fn()) return true;
      await sleep(100);
    }
    return false;
  };
  const idOf = async (title) => (await nodes()).find((n) => n.title === title)?.id;
  /** 结构签名：(卷)标题 / 卷>章 */
  const shape = async () => {
    const ns = await nodes();
    const t = Object.fromEntries(ns.map((n) => [n.id, n.title]));
    return ns.map((n) => (n.kind === "folder" ? `[${n.title}]` : n.parent_id ? `${t[n.parent_id]}>${n.title}` : n.title)).join(" | ");
  };
  /** 磁盘按文件名排序遍历（一层子目录）与 DB 先序逐项相同 */
  const diskConsistent = async () => {
    const ms = join(LIB, book.slug, "manuscript");
    const names = (p) => readdirSync(p).filter((x) => !x.startsWith(".") && x !== "_index.md").sort();
    const disk = [];
    for (const nme of names(ms)) {
      if (!nme.endsWith(".md")) {
        disk.push(`${nme}/`);
        for (const k of names(join(ms, nme))) disk.push(`${nme}/${k}`);
      } else disk.push(nme);
    }
    const db = (await nodes()).map((n) => {
      const rel = n.file_path.split("/manuscript/")[1];
      return n.kind === "folder" ? `${rel}/` : rel;
    });
    return { ok: JSON.stringify(disk) === JSON.stringify(db), disk, db };
  };
  let dc = await diskConsistent();
  check("磁盘：卷 = 子目录，文件名序 = 目录先序", dc.ok && dc.disk.filter((x) => x.endsWith("/")).length === 3, dc.disk.join(" "));

  const rowsUI = () => ev(`[...document.querySelectorAll('[data-chapter-row]')].map(r => (r.dataset.kind === 'folder' ? '[' : '') + r.querySelector('span.truncate')?.textContent + (r.dataset.kind === 'folder' ? ']' : '') + '@' + r.dataset.depth)`);
  const rowBox = (title) =>
    ev(`(() => { const r = [...document.querySelectorAll('[data-chapter-row]')].find(r => r.querySelector('span.truncate')?.textContent === ${JSON.stringify(title)}); if (!r) return null; r.scrollIntoView({block:'nearest'}); const b = r.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, top: b.top, bottom: b.bottom } })()`);
  const mouse = (type, x, y, modifiers = 0) =>
    app.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, modifiers });
  const clickRow = async (title, { ctrl = false, shift = false, button = "left" } = {}) => {
    const p = await rowBox(title);
    if (!p) throw new Error(`找不到行：${title}`);
    const m = (ctrl ? 2 : 0) | (shift ? 8 : 0);
    await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button, buttons: button === "left" ? 1 : 2, clickCount: 1, modifiers: m });
    await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button, buttons: 0, clickCount: 1, modifiers: m });
    await sleep(200);
  };
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
    await sleep(500);
    return mid;
  };
  const clickMenu = async (text) => {
    await app.clickEl(`[...document.querySelectorAll('[role="menuitem"]')].find(m => m.textContent.includes(${JSON.stringify(text)}))`);
    await sleep(250);
  };
  const openBook = async () => {
    await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.nav.view', 'write'); localStorage.removeItem('bixian.binder.collapsed.${book.id}'); true`);
    await app.reload();
    try {
      await waitFor(ev, `document.querySelectorAll('[data-chapter-row]').length === 8`, 5000);
    } catch {
      await app.press("b", { ctrl: true });
      await waitFor(ev, `document.querySelectorAll('[data-chapter-row]').length === 8`, 6000);
    }
  };

  await openBook();
  const ui0 = await rowsUI();
  check(
    "侧栏三卷结构（卷行 + 缩进的章）",
    JSON.stringify(ui0) ===
      JSON.stringify(["[第一卷 风雪]@0", "第一章 渡口@1", "第二章 旧城@1", "[第二卷 灯会]@0", "第三章 夜市@1", "第四章 别离@1", "[第三卷 归途]@0", "第五章 雪夜@1"]),
    ui0.join(" "),
  );
  await app.screenshot(`${SHOTS}/1-tree.png`);

  // ② 指针拖「第二章 旧城」到「第二卷 灯会」行上 = 放进该卷（卷末）
  const mid = await drag(await rowBox("第二章 旧城"), await rowBox("第二卷 灯会"), () =>
    ev(`({ ring: [...document.querySelectorAll('[data-chapter-row]')].find(r => r.textContent.includes('第二卷 灯会'))?.className.includes('ring-2') ?? false, ghost: document.querySelector('[data-drag-ghost]')?.innerText ?? '' })`),
  );
  check("拖到卷上：卷整行高亮、跟手标签「放进」", mid.ring && mid.ghost.includes("放进"), JSON.stringify(mid));
  await until(async () => (await shape()).includes("第二卷 灯会>第二章 旧城"));
  await sleep(300);
  const s2 = await shape();
  dc = await diskConsistent();
  check("跨卷拖动：DB 归属 + 磁盘目录一致", s2.includes("第二卷 灯会>第二章 旧城") && dc.ok, s2);
  check("侧栏同步", (await rowsUI()).join(" ").includes("第四章 别离@1 第二章 旧城@1"));

  // ③ Ctrl+← 移出卷、Ctrl+→ 并入上一卷
  await clickRow("第二章 旧城");
  await app.press("ArrowLeft", { ctrl: true });
  await sleep(600);
  const s3 = await shape();
  check("Ctrl+← 移出所在卷（落到卷后，顶层）", s3.includes("第四章 别离 | 第二章 旧城 | [第三卷 归途]"), s3);
  await app.press("ArrowRight", { ctrl: true });
  await sleep(600);
  const s4 = await shape();
  dc = await diskConsistent();
  check("Ctrl+→ 并入上一卷（卷末）", s4.includes("第二卷 灯会>第二章 旧城") && dc.ok, s4);

  // ④ 关闭重启 → 从磁盘重建索引：结构不变，其他书不动
  const before = await shape();
  await app.restart();
  await ev(DIALOG_PROBE);
  try {
    await waitFor(ev, `document.querySelectorAll('[data-chapter-row]').length === 8`, 6000);
  } catch {
    await openBook();
  }
  await app.clickEl(`document.querySelector('[data-book-switcher]')`);
  await clickMenu("从磁盘重建索引");
  await waitFor(ev, `document.body.innerText.includes('已从磁盘重建索引')`);
  check("重启 + 重建索引后结构不变", (await shape()) === before, before);
  check("重建索引未改动其他书", (await snapshotOthers(book.id)) === others0);

  // ⑤ AI 预览：第三卷首章的「上一章结尾」= 跨卷前一章（第二卷末章 = 第二章 旧城）
  const snow = await idOf("第五章 雪夜");
  const session = await app.invoke("get_or_create_session", { chapterId: snow });
  const log = await app.invoke("preview_context", { sessionId: session.id, instruction: "继续", options: null });
  const prev = log.slots.find((x) => x.name === "上一章结尾");
  check("AI 预览「上一章结尾」为跨卷前一章", !!prev && prev.preview_head.includes("林晚递来半张地图"), prev?.preview_head ?? "无");

  // ⑥ 单击卷 → 编辑区组视图看卷内各章；Ctrl+1 串烧含卷名
  await clickRow("第二卷 灯会");
  const gv = await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.innerText`, 4000).catch(() => "");
  check("单击卷 → 组视图显示卷内各章", gv.includes("第二卷 灯会") && gv.includes("第三章 夜市") && gv.includes("第二章 旧城") && !gv.includes("第五章 雪夜"), gv.slice(0, 80));
  await app.screenshot(`${SHOTS}/2-volume-group.png`);
  const mode = await ev(`document.querySelector('[data-testid="group-view"]').dataset.groupMode`);
  await app.press("1", { ctrl: true, code: "Digit1" });
  const scriv = await waitFor(ev, `document.querySelector('[data-testid="group-view"]')?.dataset.groupMode === 'scrivenings' && document.querySelector('[data-testid="group-view"]').innerText.includes('夜市人声鼎沸')`).catch(() => false);
  check("串烧：卷内全部章连读", !!scriv);
  if (mode && mode !== "scrivenings") await app.press("1", { ctrl: true, code: "Digit1" });

  // ⑦ 聚焦此卷（Hoist）→ 只剩卷内章 → 退出
  await clickRow("第二卷 灯会", { button: "right" });
  await clickMenu("聚焦此卷");
  const hoisted = await rowsUI();
  check("聚焦此卷：侧栏只剩卷内章", JSON.stringify(hoisted) === JSON.stringify(["第三章 夜市@0", "第四章 别离@0", "第二章 旧城@0"]), hoisted.join(" "));
  await app.clickEl(`document.querySelector('button[aria-label="退出聚焦"]')`);
  await sleep(200);
  check("退出聚焦回到全书", (await rowsUI()).length === 8);

  // ⑧ 光标处拆分（Ctrl+Shift+K）+ 撤销
  await clickRow("第五章 雪夜");
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('旧人归来')`);
  await ev(`(() => { const ed = document.querySelector('.ProseMirror'); ed.focus(); const p = ed.querySelectorAll('p')[1]; const r = document.createRange(); r.setStart(p.firstChild, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true })()`);
  await sleep(150);
  await app.press("k", { ctrl: true, shift: true });
  await waitFor(ev, `!!document.querySelector('[aria-modal="true"] input')`);
  await app.press("Enter");
  await until(async () => (await shape()).includes("第五章 雪夜（续）"));
  await sleep(600);
  const s8 = await shape();
  const tailId = await idOf("第五章 雪夜（续）");
  const tailBody = tailId ? (await app.invoke("read_chapter", { id: tailId })).content : "";
  const headBody = (await app.invoke("read_chapter", { id: snow })).content;
  dc = await diskConsistent();
  check(
    "拆分：新章紧随其后、同卷，前后两半各归其位",
    s8.includes("第三卷 归途>第五章 雪夜 | 第三卷 归途>第五章 雪夜（续）") && headBody.trim() === "雪夜渡口。" && tailBody.trim() === "旧人归来。" && dc.ok,
    `${s8} / ${headBody} / ${tailBody}`,
  );
  check("编辑器只剩前半", !(await ev(`document.querySelector('.ProseMirror').textContent.includes('旧人归来')`)));
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '撤销')`);
  await sleep(800);
  const s8b = await shape();
  check("拆分撤销：回到一章、全文还原", !s8b.includes("（续）") && (await app.invoke("read_chapter", { id: snow })).content.includes("旧人归来"), s8b);

  // ⑨ 合并（同卷相邻两章）+ 撤销
  await clickRow("第三章 夜市");
  await clickRow("第四章 别离", { shift: true });
  await clickRow("第四章 别离", { button: "right" });
  await clickMenu("合并为一章");
  await sleep(800);
  const s9 = await shape();
  const merged = (await app.invoke("read_chapter", { id: await idOf("第三章 夜市") })).content;
  dc = await diskConsistent();
  check("合并：第二章并入第一章、其余进回收站", !s9.includes("第四章 别离") && merged.includes("夜市人声鼎沸") && merged.includes("她没有回头") && dc.ok, s9);
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '撤销')`);
  await sleep(1000);
  const s9b = await shape();
  dc = await diskConsistent();
  check(
    "合并撤销：两章都回来、正文还原、位置不变",
    s9b.includes("第二卷 灯会>第三章 夜市 | 第二卷 灯会>第四章 别离") && !(await app.invoke("read_chapter", { id: await idOf("第三章 夜市") })).content.includes("她没有回头") && dc.ok,
    s9b,
  );

  // ⑩ 删卷（含章）→ 确认 → Toast 撤销
  await clickRow("第一卷 风雪");
  await app.press("Delete");
  await waitFor(ev, `!!document.querySelector('[aria-modal="true"]')`);
  await app.press("Enter");
  await until(async () => !(await shape()).includes("第一卷 风雪"));
  await sleep(500);
  check("删卷：卷与卷内章一并进回收站", !(await shape()).includes("第一章 渡口"));
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '撤销')`);
  await sleep(1200);
  const s10 = await shape();
  dc = await diskConsistent();
  check("删卷撤销：卷与章回到原位", s10.startsWith("[第一卷 风雪] | 第一卷 风雪>第一章 渡口") && dc.ok, s10);

  // ⑪ Alt+Shift+N 新建卷 → 行内命名
  await clickRow("第五章 雪夜");
  await app.press("N", { alt: true, shift: true, code: "KeyN" });
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '新名称'`);
  await app.press("a", { ctrl: true });
  await app.typeText("番外卷");
  await app.press("Enter");
  await sleep(800);
  const s11 = await shape();
  dc = await diskConsistent();
  check("Alt+Shift+N 新建卷并命名（目录落盘）", s11.endsWith("[番外卷]") && dc.ok && dc.disk.some((x) => x.endsWith("番外卷/")), s11);

  // ⑫ 导出：卷名按序出现
  const dest = join(TMP, "导出.txt");
  await app.invoke("export_txt", { bookId: book.id, chapterIds: [], indent: false, dest });
  const out = readFileSync(dest, "utf8");
  const at = (s) => out.indexOf(s);
  check("导出 txt 带卷名且顺序正确", at("第一卷 风雪") >= 0 && at("第一卷 风雪") < at("第一章 渡口") && at("第二卷 灯会") < at("第三章 夜市") && at("第三卷 归途") < at("第五章 雪夜"));

  check("全程无原生对话框", (await ev(`(window.__nativeDialogs ?? []).length`)) === 0);
  return summary();
});
