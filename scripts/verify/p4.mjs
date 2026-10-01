// 阶段 4 实机核验：一致性收口。
// 1 快捷键速查（Ctrl+/，数据来自命令注册表）
// 2 键盘可达与焦点环：Tab 走一遍，每个非文本控件聚焦时都要有看得见的变化（与失焦时的样式比较）
// 3 各视图 × 三套主题截图（暗夜 / 晨光 / 枫叶）→ .tmp-verify/p4/，交你目测
// 4 性能基线：10 万字长章按键延迟、300 章目录滚动帧时、主题切换无闪烁 → .tmp-verify/p4/perf.json
// 用法（应用已带调试端口启动）：node scripts/verify/p4.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";

const SHOTS = ".tmp-verify/p4";
const VIEWS = ["write", "bump", "read", "styles", "stats", "materials", "graph", "structure"];
const THEMES = [
  ["bixian-dark", "dark"],
  ["bixian-light", "light"],
  ["maple", "light"],
];

await withGuard("p4", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = app.evaluate;
  mkdirSync(SHOTS, { recursive: true });

  // ---- 测试书：一本普通书（含 10 万字长章）+ 一本 300 章的书 ----
  const para = "夜雨落在渡口的青石板上，灯笼一盏接一盏亮起，沈砚站在船头望着旧城。";
  const long = Array.from({ length: Math.ceil(100_000 / para.length) }, () => para).join("\n\n");
  const { book, ids } = await makeBook("阶段四", [
    ["第一章 渡口", "渡口的灯笼次第亮起。沈砚站在船头。"],
    ["第二章 长章", long],
  ]);
  const big = await makeBook("三百章", []);
  const bigIds = [];
  for (let i = 1; i <= 300; i++) bigIds.push((await app.invoke("create_chapter", { bookId: big.book.id, title: `第${i}章` })).id);
  const openBook = async (bookId, view = "write") => {
    await ev(`localStorage.setItem('bixian.lastBookId', '${bookId}'); localStorage.setItem('bixian.nav.view', '${view}'); true`);
    await app.reload();
    await waitFor(ev, `!!document.querySelector('main')`, 15000);
    await sleep(500);
  };
  await openBook(book.id);
  await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[0]}"]')`, 8000);
  await app.clickEl(`document.querySelector('[data-chapter-row="${ids[0]}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('沈砚站在船头')`);

  // ================= 1 快捷键速查 =================
  await app.clickEl(`document.querySelector('.ProseMirror')`);
  await app.press("/", { ctrl: true, code: "Slash" });
  await waitFor(ev, `!!document.querySelector('[data-testid="shortcut-sheet"]')`, 3000);
  const rows = await ev(`document.querySelectorAll('[data-shortcut-row]').length`);
  const sheetText = await ev(`document.querySelector('[data-testid="shortcut-sheet"]').innerText`);
  check("Ctrl+/ 打开快捷键速查：来自命令注册表、分组列出", rows >= 25 && sheetText.includes("快捷键速查") && sheetText.includes("Ctrl+/") && sheetText.includes("Alt+K"), `${rows} 条`);
  await app.typeText("分屏");
  await sleep(150);
  const filtered = await ev(`[...document.querySelectorAll('[data-shortcut-row]')].map(r => r.innerText)`);
  check("速查可搜索", filtered.length >= 1 && filtered.every((t) => t.includes("分屏")), filtered.join(" | ").slice(0, 60));
  await app.screenshot(`${SHOTS}/shortcut-sheet.png`);
  await app.press("Escape");
  await sleep(200);
  check("Esc 关闭速查", !(await ev(`!!document.querySelector('[data-testid="shortcut-sheet"]')`)));

  // ================= 2 键盘可达与焦点环 =================
  await ev(`(() => { document.activeElement?.blur?.(); document.body.focus(); return true })()`);
  const seen = new Map();
  const missing = [];
  for (let i = 0; i < 140; i++) {
    await app.press("Tab");
    const info = await ev(`(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const tag = el.tagName.toLowerCase();
      const textual = tag === 'textarea' || (tag === 'input' && !['checkbox','radio','range','button','submit'].includes(el.type)) || el.isContentEditable;
      const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\\s+/g, ' ').slice(0, 24);
      const key = tag + '|' + (el.getAttribute('role') || '') + '|' + label;
      if (textual) return { key, textual, ok: true };
      const pick = () => { const c = getComputedStyle(el); return [c.outlineStyle, c.outlineWidth, c.outlineColor, c.boxShadow, c.backgroundColor, c.borderColor, c.color, c.textDecorationLine].join('§'); };
      // 量的是终态：临时关掉过渡（按钮的 box-shadow / 底色过渡会让失焦瞬间读到的仍是聚焦时的值）
      const prevTransition = el.style.transition;
      el.style.transition = 'none';
      const focused = pick();
      el.blur();
      const blurred = pick();
      el.focus();
      el.style.transition = prevTransition;
      return { key, textual, ok: focused !== blurred };
    })()`);
    if (!info) continue;
    if (seen.has(info.key)) continue;
    seen.set(info.key, info);
    if (!info.ok) missing.push(info.key);
  }
  check("Tab 能走到的控件（去重）数量合理", seen.size >= 25, `${seen.size} 个`);
  check("每个非文本控件键盘聚焦时都有看得见的焦点指示", missing.length === 0, missing.slice(0, 8).join(" ; "));

  // ================= 3 各视图 × 主题截图 =================
  const appearance = await ev(`localStorage.getItem('bixian.appearance')`);
  const base = appearance ? JSON.parse(appearance) : {};
  for (const [theme, mode] of THEMES) {
    await ev(`localStorage.setItem('bixian.appearance', ${JSON.stringify(JSON.stringify({ ...base, colorTheme: theme, mode }))}); true`);
    for (const v of VIEWS) {
      await openBook(book.id, v);
      if (v === "write") {
        await app.clickEl(`document.querySelector('[data-chapter-row="${ids[0]}"]')`).catch(() => {});
        await sleep(400);
      }
      await app.screenshot(`${SHOTS}/${theme}-${v}.png`);
    }
    await app.press(",", { ctrl: true, code: "Comma" });
    await waitFor(ev, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '外观')`, 3000);
    await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '外观')`);
    await sleep(400);
    await app.screenshot(`${SHOTS}/${theme}-settings.png`);
    await app.press("Escape");
  }
  await ev(`localStorage.setItem('bixian.appearance', ${JSON.stringify(appearance ?? "{}")}); true`);
  check("三套主题 × 8 个视图 + 设置截图已存（交你目测）", true, `${SHOTS}/`);

  // ================= 4 性能基线 =================
  const perf = { at: new Date().toISOString() };
  // 4a 10 万字长章：按键到下一帧上屏
  await openBook(book.id);
  await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
  await waitFor(ev, `(document.querySelector('.ProseMirror')?.textContent.length ?? 0) > 90000`, 20000);
  perf.longChapterChars = await ev(`document.querySelector('.ProseMirror').textContent.length`);
  await ev(`(() => { const ed = document.querySelector('.ProseMirror'); const p = ed.lastElementChild; ed.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    window.__lat = []; ed.addEventListener('beforeinput', (e) => { const t0 = e.timeStamp; requestAnimationFrame(() => requestAnimationFrame(() => window.__lat.push(performance.now() - t0))); }, true); return true })()`);
  await sleep(300);
  for (let i = 0; i < 60; i++) {
    await app.typeText("字");
    await sleep(40);
  }
  await sleep(400);
  const lat = (await ev(`window.__lat`)).sort((a, b) => a - b);
  const pct = (arr, p) => Math.round(arr[Math.min(arr.length - 1, Math.floor(arr.length * p))] * 10) / 10;
  perf.keystroke = { samples: lat.length, p50: pct(lat, 0.5), p95: pct(lat, 0.95), max: Math.round(lat.at(-1) * 10) / 10 };
  check("10 万字长章：按键到上屏 p95 < 50ms", lat.length >= 50 && perf.keystroke.p95 < 50, JSON.stringify(perf.keystroke));
  // 4b 300 章目录滚动
  await openBook(big.book.id);
  await waitFor(ev, `!!document.querySelector('[data-chapter-row="${bigIds[0]}"]')`, 10000);
  perf.binder = await ev(`new Promise((resolve) => {
    const row = document.querySelector('[data-chapter-row="${bigIds[0]}"]');
    let sc = row.parentElement; while (sc && !(sc.scrollHeight > sc.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
    if (!sc) return resolve({ error: '找不到滚动容器' });
    sc.scrollTop = 0; const frames = []; let last = performance.now();
    const step = (t) => { frames.push(t - last); last = t; sc.scrollTop += 24; if (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2 && frames.length < 600) requestAnimationFrame(step); else {
      const f = frames.slice(1).sort((a, b) => a - b); const avg = f.reduce((a, b) => a + b, 0) / f.length;
      resolve({ rows: document.querySelectorAll('[data-chapter-row]').length, frames: f.length, avgMs: Math.round(avg * 10) / 10, p95Ms: Math.round(f[Math.floor(f.length * 0.95)] * 10) / 10, longFrames: f.filter((x) => x > 33.4).length }); } };
    requestAnimationFrame((t) => { last = t; requestAnimationFrame(step); });
  })`);
  check("300 章目录滚动：平均帧时 ≤ 20ms、长帧（>33ms）≤ 2%", !perf.binder.error && perf.binder.avgMs <= 20 && perf.binder.longFrames <= Math.ceil(perf.binder.frames * 0.02), JSON.stringify(perf.binder));
  // 4c 主题切换无闪烁：逐帧取背景色，只允许「旧色 → 新色」一次跳变
  await app.press(",", { ctrl: true, code: "Comma" });
  await waitFor(ev, `[...document.querySelectorAll('button')].some(b => b.textContent.trim() === '外观')`, 3000);
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === '外观')`);
  await sleep(300);
  await ev(`(() => { window.__bg = []; const tick = () => { window.__bg.push(getComputedStyle(document.body).backgroundColor + '|' + getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim()); if (window.__bg.length < 40) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true })()`);
  await sleep(100);
  await app.clickEl(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('枫叶'))`);
  await sleep(1200);
  const bg = await ev(`window.__bg`);
  const distinct = bg.filter((x, i) => i === 0 || x !== bg[i - 1]);
  perf.themeSwitch = { frames: bg.length, transitions: distinct.length - 1, sequence: distinct };
  check("主题切换无闪烁：背景只从旧色一次跳到新色（无中间色、无闪白）", perf.themeSwitch.transitions === 1, distinct.join(" → "));
  await app.press("Escape");
  writeFileSync(`${SHOTS}/perf.json`, JSON.stringify(perf, null, 2));
  console.log("性能基线：", JSON.stringify(perf));
  check("全程没有原生对话框", (await ev(`(window.__nativeDialogs ?? []).length`)) === 0);
  return summary();
});
