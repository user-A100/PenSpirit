// 阶段 1 实机核验：Zen 骨架层级 / 右侧竖条不截断 / 明暗真实切换 / 减少动效 / 命令面板 / 专注模式 + 截图集。
// 用法（应用已带调试端口启动）：node scripts/verify/p1.mjs
import { checker, sleep, waitFor, withGuard } from "./lib.mjs";

const SHOTS = ".tmp-verify/p1";

await withGuard("p1", async ({ app, makeBook }) => {
  const { check, summary } = checker();
  const ev = app.evaluate;
  const { book, ids } = await makeBook("阶段一", [
    ["序章 渡口", "渡口的灯笼次第亮起。"],
    ["第一章 林晚", "林晚站在船头。"],
    ["第二章 旧城灯火", "旧城灯会。"],
  ]);
  await ev(`localStorage.setItem('bixian.lastBookId', '${book.id}'); localStorage.setItem('bixian.nav.view', 'write'); true`);
  await app.reload();
  await waitFor(ev, `!!document.querySelector('[data-chapter-row="${ids[1]}"]')`, 8000);
  await app.clickEl(`document.querySelector('[data-chapter-row="${ids[1]}"]')`);
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('林晚')`);

  // ① 层级：导航/侧栏贴背板（透明、无描边），内容是带阴影的圆角卡
  const layer = await ev(`(() => {
    const cs = (el) => el ? getComputedStyle(el) : null;
    const ribbon = cs(document.querySelector('aside[aria-label="视图"]'));
    const sidebarRoot = document.querySelector('[data-book-switcher]')?.closest('.panel-sidebar')?.firstElementChild;
    const side = cs(sidebarRoot);
    const card = cs(document.querySelector('.zen-card'));
    const borders = (s) => s ? ['Top','Right','Bottom','Left'].map(k => parseFloat(s['border' + k + 'Width'])).reduce((a,b)=>a+b,0) : -1;
    return {
      ribbonBg: ribbon?.backgroundColor, ribbonBorder: borders(ribbon),
      sideBg: side?.backgroundColor, sideBorder: borders(side),
      cardShadow: card?.boxShadow, cardRadius: card?.borderTopLeftRadius,
    };
  })()`);
  check("Ribbon 透明贴背板、无描边", layer.ribbonBg === "rgba(0, 0, 0, 0)" && layer.ribbonBorder === 0, `${layer.ribbonBg} / ${layer.ribbonBorder}px`);
  check("侧栏透明贴背板、无描边", layer.sideBg === "rgba(0, 0, 0, 0)" && layer.sideBorder === 0, `${layer.sideBg} / ${layer.sideBorder}px`);
  check("内容卡有阴影与 token 圆角", layer.cardShadow && layer.cardShadow !== "none" && layer.cardRadius === "8px", `${layer.cardRadius}`);

  // ② 右侧竖条：8 个面板图标（阶段 3A 起集合迁入 Binder），不再挤成一行；面板标题完整显示
  const rail = await ev(`(() => {
    const btns = [...document.querySelectorAll('[data-dock-panel]')];
    const title = document.querySelector('.panel-dock .zen-card span.truncate');
    return { n: btns.length, labels: btns.map(b => b.getAttribute('aria-label')), titleFits: title ? title.scrollWidth <= title.clientWidth : false, title: title?.textContent };
  })()`);
  check("右侧竖条 8 个面板按组排列", rail.n === 8, rail.labels.join("/"));
  check("dock 标题完整不截断", rail.titleFits, rail.title);
  await app.clickEl(`document.querySelector('[data-dock-panel="characters"]')`);
  await sleep(300);
  check("竖条切换面板", (await ev(`document.querySelector('.panel-dock .zen-card span.truncate')?.textContent`)) === "人物");
  await app.clickEl(`document.querySelector('[data-dock-panel="characters"]')`);
  await sleep(300);
  check("再点当前面板 = 折叠 dock", await ev(`!!document.querySelector('[data-dock-collapsed]')`));
  await app.clickEl(`document.querySelector('[data-dock-panel="meta"]')`);
  await sleep(300);
  check("点任一图标展开 dock 并切到该面板", await ev(`!document.querySelector('[data-dock-collapsed]') && document.querySelector('.panel-dock .zen-card span.truncate')?.textContent === '元数据'`));

  // ③ 明暗真实生效（修死开关）：mode 切换改变实际配色与 data-tone
  const setMode = async (m) => {
    await ev(`(async () => { const mod = await import('/src/themes/ThemeProvider.tsx'); mod.useAppearance.getState().setMode('${m}'); return true })()`);
    await sleep(250);
    return ev(`({ tone: document.documentElement.dataset.tone, panel: getComputedStyle(document.documentElement).getPropertyValue('--bg-panel').trim() })`);
  };
  const dark = await setMode("dark");
  const light = await setMode("light");
  check("「深色」→ data-tone=dark", dark.tone === "dark", dark.panel);
  check("「浅色」→ data-tone=light 且卡片底色真的变了", light.tone === "light" && light.panel !== dark.panel, `${dark.panel} → ${light.panel}`);
  await app.screenshot(`${SHOTS}/light-write.png`);
  await setMode("dark");
  await app.screenshot(`${SHOTS}/dark-write.png`);

  // ④ 减少动效：系统开启时过渡近乎瞬时
  await app.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  const dur = await ev(`getComputedStyle(document.querySelector('aside[aria-label="视图"] button')).transitionDuration`);
  await app.send("Emulation.setEmulatedMedia", { features: [] });
  check("prefers-reduced-motion 下过渡 ≤ 0.01s", dur.split(",").every((d) => parseFloat(d) <= 0.01), dur);

  // ⑤ 命令面板：Ctrl+K → 拼音首字母跳章
  await ev(`document.querySelector('.ProseMirror').focus()`);
  await app.press("k", { ctrl: true });
  await waitFor(ev, `!!document.querySelector('[aria-label="命令面板"]')`);
  await app.typeText("jcdh");
  await sleep(150);
  // 限定在命令面板内（阶段 3A 起 Binder 行也是 listbox option）
  const top = await ev(`document.querySelector('[aria-label="命令面板"] [role="option"]')?.textContent`);
  check("命令面板拼音首字母命中章节", (top ?? "").includes("第二章 旧城灯火"), top);
  await app.press("Enter");
  await waitFor(ev, `document.querySelector('.ProseMirror')?.textContent.includes('旧城灯会')`);
  check("Enter 跳到该章", true);
  await app.press("k", { ctrl: true });
  await waitFor(ev, `document.activeElement?.getAttribute('aria-label') === '搜索章节、书与命令'`);
  await app.typeText(">专注");
  await sleep(150);
  await app.screenshot(`${SHOTS}/palette.png`);
  await app.press("Enter");
  await sleep(400);

  // ⑥ 专注模式：只留稿纸
  const focus = await ev(`({ ribbon: !!document.querySelector('aside[aria-label="视图"]'), rail: !!document.querySelector('[aria-label="右侧面板"]'), side: !!document.querySelector('[data-book-switcher]'), editor: !!document.querySelector('.ProseMirror') })`);
  check("命令面板执行「专注模式」：隐去 Ribbon/侧栏/竖条，只留稿纸", !focus.ribbon && !focus.rail && !focus.side && focus.editor, JSON.stringify(focus));
  await app.screenshot(`${SHOTS}/focus.png`);
  await app.press("F11");
  await sleep(400);
  check("F11 退出专注模式，chrome 还原", await ev(`!!document.querySelector('aside[aria-label="视图"]') && !!document.querySelector('[data-book-switcher]')`));

  // ⑦ 统一视图壳：各一级视图都有同款 h1 头部
  const heads = [];
  for (const v of ["stats", "styles", "bump", "materials", "graph", "structure"]) {
    await ev(`document.querySelector('aside button[data-view="${v}"]')?.click()`);
    await sleep(500);
    heads.push(await ev(`document.querySelector('main h1')?.textContent ?? ''`));
    await app.screenshot(`${SHOTS}/view-${v}.png`);
  }
  check("6 个一级视图统一头部", heads.every((h) => h.length > 0), heads.join(" / "));
  await ev(`document.querySelector('aside button[data-view="write"]')?.click()`);

  return summary();
});
