// CDP 验证：P3 浮卡式布局骨架
// 用法：node scripts/zen-verify/verify-p3.mjs
const PORT = 9222;

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("找不到 page target：app 未以 --remote-debugging-port=9222 启动？");
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) => {
  const mid = ++id;
  ws.send(JSON.stringify({ id: mid, method, params }));
  return new Promise((r) => pending.set(mid, r));
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.error) return { __err: r.error.message };
  const ro = r.result?.result;
  if (ro?.subtype === "error") return { __err: ro.description };
  return ro?.value;
};

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

const booted = await evalJs(`!!document.querySelector('#root')?.children.length`);
if (booted !== true) {
  console.error("app 未加载出 Tauri internals");
  process.exit(1);
}

// 1. --sep token 与背板缝隙
const shell = await evalJs(
  `(() => {
     const s = getComputedStyle(document.documentElement);
     const main = document.querySelector('main');
     const card = main?.firstElementChild;
     if (!card) return { __err: 'main 下未找到内容浮卡' };
     const mcs = getComputedStyle(main), ccs = getComputedStyle(card);
     const root = document.querySelector('#root > div');
     return {
       sep: s.getPropertyValue('--sep').trim(),
       mainPad: [mcs.paddingTop, mcs.paddingRight, mcs.paddingBottom, mcs.paddingLeft],
       rootBg: getComputedStyle(root).backgroundColor,
       cardBg: ccs.backgroundColor,
       cardRadius: ccs.borderRadius,
       cardOverflow: ccs.overflow,
     };
   })()`,
);
check("--sep=8px 且 main 四周留缝",
  shell && shell.sep === "8px" && shell.mainPad.every((p) => p === "8px"),
  JSON.stringify(shell));
check("内容浮卡：8px 圆角 + bg-panel + 裁切",
  shell && shell.cardRadius === "8px" && shell.cardOverflow === "hidden" &&
    shell.cardBg !== shell.rootBg,
  `card=${shell?.cardBg} root=${shell?.rootBg} radius=${shell?.cardRadius} overflow=${shell?.cardOverflow}`);

// 2. Ribbon 已去掉右边框（改用缝隙分隔）
const ribbon = await evalJs(
  `(() => { const r = document.querySelector('aside'); const cs = getComputedStyle(r);
     return { w: cs.width, borderRight: cs.borderRightWidth, bg: cs.backgroundColor }; })()`,
);
check("Ribbon 无右边框、48px 宽",
  ribbon && ribbon.borderRight === "0px" && ribbon.w === "48px",
  JSON.stringify(ribbon));

// 3. 内容区不再自绘 bg-base（编辑器/侧栏/视图壳各层都应透明，露出卡片底）
const panes = await evalJs(
  `(() => {
     const card = document.querySelector('main').firstElementChild;
     const base = getComputedStyle(document.querySelector('#root > div')).backgroundColor;
     const hits = [];
     const walk = (el) => {
       if (getComputedStyle(el).backgroundColor === base) {
         hits.push(el.tagName + '.' + (el.className || '').toString().slice(0, 50));
       }
       for (const c of el.children) walk(c);
     };
     walk(card);
     return { baseRgb: base, paintingBase: hits, count: hits.length };
   })()`,
);
check("卡片内无元素再绘制 bg-base（内容区已统一到卡片底）",
  panes && panes.count === 0,
  JSON.stringify(panes));

// 4. 各一级视图仍在卡片内渲染
const views = await evalJs(
  `(async () => {
     const out = {};
     for (const label of ['文风库', '素材库', '统计', '碰碰车', '阅读', '写作']) {
       const btn = document.querySelector('button[title="' + label + '"]');
       if (!btn) { out[label] = 'no-button'; continue; }
       btn.click();
       await new Promise(r => setTimeout(r, 250));
       const card = document.querySelector('main')?.firstElementChild;
       const filled = (card?.getBoundingClientRect().height ?? 0) > 100;
       const alive = (document.querySelector('#root')?.children.length ?? 0) > 0;
       out[label] = filled && alive ? 'ok' : 'h=' + Math.round(card?.getBoundingClientRect().height ?? 0);
     }
     return out;
   })()`,
);
check("六个一级视图均在浮卡内正常渲染",
  views && Object.values(views).every((v) => v === "ok"),
  JSON.stringify(views));

// 5. 弹窗/浮窗不受卡片裁切（fixed 定位逃逸）
const escape = await evalJs(
  `(async () => {
     document.querySelector('button[title="设置"]')?.click();
     await new Promise(r => setTimeout(r, 300));
     const bd = document.querySelector('[data-testid="settings-backdrop"]');
     if (!bd) return { __err: 'settings-backdrop 未渲染' };
     const r = bd.getBoundingClientRect();
     const cs = getComputedStyle(bd);
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
     return { pos: cs.position, top: Math.round(r.top), left: Math.round(r.left),
              w: Math.round(r.width), vw: window.innerWidth };
   })()`,
);
check("弹窗 fixed 逃逸卡片裁切（铺满视口）",
  escape && escape.pos === "fixed" && escape.top === 0 && escape.left === 0 && escape.w === escape.vw,
  JSON.stringify(escape));

// 6. 回收站浮层未被卡片裁掉（横跨三栏仍在卡内）
// 侧栏可能被前面的脚本（点当前视图按钮 = 折叠侧栏）收起，先展开再测
const trash = await evalJs(
  `(async () => {
     if (!document.querySelector('button[data-trash-toggle]')) {
       document.querySelector('button[title^="展开侧栏"]')?.click();
       await new Promise(r => setTimeout(r, 300));
     }
     const btn = document.querySelector('button[data-trash-toggle]');
     if (!btn) return { __err: '回收站按钮不存在（侧栏展开失败）' };
     btn.click();
     await new Promise(r => setTimeout(r, 300));
     const panel = document.querySelector('div.absolute.left-2.top-full');
     if (!panel) return { __err: '回收站浮层未渲染' };
     const pr = panel.getBoundingClientRect();
     const cr = document.querySelector('main').firstElementChild.getBoundingClientRect();
     const inside = pr.right <= cr.right && pr.bottom <= cr.bottom && pr.left >= cr.left;
     btn.click();
     return { panelRight: Math.round(pr.right), cardRight: Math.round(cr.right),
              panelBottom: Math.round(pr.bottom), cardBottom: Math.round(cr.bottom), inside };
   })()`,
);
check("回收站浮层完整落在卡片内（不被裁切）",
  trash && trash.inside === true,
  JSON.stringify(trash));

// 截图（写作视图 + 枫叶，便于肉眼确认）
await evalJs(`(async () => {
  const b = document.querySelector('button[title="写作"]');
  if (b && !b.querySelector('span[aria-hidden]')) b.click();
  await new Promise(r => setTimeout(r, 400));
})()`);
const { writeFileSync, mkdirSync } = await import("node:fs");
const shot = await send("Page.captureScreenshot", { format: "png" });
mkdirSync(".tmp-zen-ref", { recursive: true });
writeFileSync(".tmp-zen-ref/p3-shell.png", Buffer.from(shot.result.data, "base64"));
console.log("已保存 .tmp-zen-ref/p3-shell.png");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
ws.close();
process.exit(failed.length ? 1 : 0);
