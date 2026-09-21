// M6 卡片改版实机核验：巡览各视图，量取卡片尺寸/内边距/圆角/字号，真实鼠标悬停验边框律动，
// 并测人物卡展开收起。读原状态 → 巡览 → 还原，不覆盖用户主题与视图偏好。
// 用法：node scripts/m6-verify/verify.mjs
const PORT = 9222;
const OUT = ".tmp-m6";

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("找不到 page target");
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
  return new Promise((r) => {
    const t = setTimeout(() => {
      if (pending.has(mid)) {
        pending.delete(mid);
        r({ __timeout: true });
      }
    }, 10000);
    pending.set(mid, (m) => {
      clearTimeout(t);
      r(m);
    });
  });
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

const ev = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  const ex = r.result?.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? ex.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(OUT, { recursive: true });
const capture = async (file) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`  截图 → ${file}`);
};

// 真实鼠标移动才会触发 CSS :hover（JS 合成 mouseover 事件不生效）
const hoverSel = async (selJs) => {
  const box = await ev(
    `(()=>{const el=${selJs}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`,
  );
  if (!box) return null;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, buttons: 0 });
  await sleep(350);
  return ev(`getComputedStyle(${selJs}).borderColor`);
};
const unhover = async () => {
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 3, y: 3, buttons: 0 });
  await sleep(200);
};

const gotoView = async (label) => {
  const ok = await ev(
    `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.title===${JSON.stringify(label)}); if(!b) return false; b.click(); return true;})()`,
  );
  await sleep(700);
  const cur = await ev(`localStorage.getItem('bixian.nav.view')`);
  if (!ok) console.log(`  !! 找不到视图按钮：${label}`);
  return cur;
};

// 新卡片语法标记：hover 边框变 accent 的可交互卡
const CARD_SEL = `[...document.querySelectorAll('div,li')].find(e=>e.className.toString().includes('hover:border-[color:var(--accent)]'))`;

const auditCards = () =>
  ev(`(()=>{
    const els=[...document.querySelectorAll('div,li')].filter(e=>e.className.toString().includes('hover:border-[color:var(--accent)]'));
    return els.slice(0,4).map(e=>{
      const cs=getComputedStyle(e); const r=e.getBoundingClientRect();
      const t=e.querySelector('span,div,p');
      return {
        w:Math.round(r.width), h:Math.round(r.height),
        pad:cs.padding, radius:cs.borderRadius,
        titleFs:t?getComputedStyle(t).fontSize:null,
        cls:e.className.toString().slice(0,58),
      };
    });
  })()`);

// ---------- 0. 等应用真正渲染完（主题注入 + root 有内容） ----------
const ready = async () => {
  for (let i = 0; i < 40; i++) {
    try {
      const ok = await ev(
        `!!(document.getElementById('root')?.children.length && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() && document.querySelector('main'))`,
      );
      if (ok === true) return true;
    } catch {
      /* 执行上下文尚未建立，重试 */
    }
    await sleep(500);
  }
  return false;
};
if (!(await ready())) {
  console.error("应用未就绪（超时）");
  process.exit(1);
}
await sleep(500);

// ---------- 0b. 读原状态 ----------
const before = await ev(
  `JSON.stringify({view:localStorage.getItem('bixian.nav.view'), appearance:localStorage.getItem('bixian.appearance')})`,
);
console.log("原状态:", before);
const theme = await ev(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
console.log("当前 accent:", theme);
console.log("");

// ---------- 1. 统计视图 ----------
console.log("【统计】");
await gotoView("统计");
const stat = await ev(`(()=>{
  const el=[...document.querySelectorAll('div')].find(e=>e.className.toString().includes('min-w-0')&&e.className.toString().includes('p-3')&&e.className.toString().includes('flex-col'));
  if(!el) return null;
  const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
  const val=[...el.children].find(c=>c.className.toString().includes('text-lg'));
  return {w:Math.round(r.width),h:Math.round(r.height),pad:cs.padding,radius:cs.borderRadius,
          labelFs:getComputedStyle(el.firstElementChild).fontSize,
          valueFs:val?getComputedStyle(val).fontSize:null};
})()`);
console.log("  StatCard:", JSON.stringify(stat));
await capture(`${OUT}/01-stats.png`);
console.log("");

// ---------- 2. 素材库 ----------
console.log("【素材库】");
await gotoView("素材库");
const mats = await auditCards();
console.log(`  可交互卡 ${mats.length} 张（取前 4）:`);
for (const m of mats) console.log("   ", JSON.stringify(m));
const matHover = await hoverSel(CARD_SEL);
console.log("  悬停边框色:", matHover);
await capture(`${OUT}/02-materials-hover.png`);
await unhover();
console.log("");

// ---------- 3. 碰碰车 ----------
console.log("【碰碰车】");
await gotoView("碰碰车");
const bump = await auditCards();
console.log(`  灵感卡 ${bump.length} 张（取前 2）:`);
for (const m of bump.slice(0, 2)) console.log("   ", JSON.stringify(m));
await capture(`${OUT}/03-bump.png`);
console.log("");

// ---------- 4. 写作页 dock：人物卡 ----------
console.log("【写作 · 人物卡】");
await gotoView("写作");
const tabOk = await ev(
  `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='人物'); if(!b) return false; b.click(); return true;})()`,
);
await sleep(700);
console.log("  切到人物 tab:", tabOk);

const cardInfo = await ev(`(()=>{
  const el=${CARD_SEL};
  if(!el) return null;
  const cs=getComputedStyle(el); const r=el.getBoundingClientRect();
  const toggle=el.querySelector('button[aria-expanded]');
  const avatar=el.querySelector('span');
  const desc=[...el.querySelectorAll('div')].find(d=>d.className.toString().includes('line-clamp-2'));
  return {
    w:Math.round(r.width), h:Math.round(r.height), pad:cs.padding, radius:cs.borderRadius,
    hasToggle: !!toggle, ariaExpanded: toggle?toggle.getAttribute('aria-expanded'):null,
    avatar: avatar?{size:getComputedStyle(avatar).width, radius:getComputedStyle(avatar).borderRadius, text:avatar.textContent}:null,
    nameFs: toggle?getComputedStyle(toggle.querySelectorAll('span')[1]).fontSize:null,
    collapsedClamp: desc?desc.className.toString().includes('line-clamp-2'):null,
    descFs: desc?getComputedStyle(desc).fontSize:null,
  };
})()`);
console.log("  人物卡:", JSON.stringify(cardInfo));

if (cardInfo?.hasToggle) {
  const hoverBorder = await hoverSel(CARD_SEL);
  console.log("  悬停边框色:", hoverBorder);
  await capture(`${OUT}/04-characters.png`);
  await unhover();

  // 展开
  await ev(`(()=>{const el=${CARD_SEL}; el.querySelector('button[aria-expanded]').click(); return true;})()`);
  await sleep(400);
  const expanded = await ev(`(()=>{
    const el=${CARD_SEL};
    const toggle=el.querySelector('button[aria-expanded]');
    const desc=[...el.querySelectorAll('div')].find(d=>d.className.toString().includes('whitespace-pre-wrap'));
    return {
      ariaExpanded: toggle.getAttribute('aria-expanded'),
      chevronRotated: !!el.querySelector('.rotate-180'),
      clampRemoved: desc?!desc.className.toString().includes('line-clamp-2'):null,
      hasDivider: !!el.querySelector('.border-t'),
    };
  })()`);
  console.log("  展开后:", JSON.stringify(expanded));
  await capture(`${OUT}/05-characters-expanded.png`);

  // 收起
  await ev(`(()=>{const el=${CARD_SEL}; el.querySelector('button[aria-expanded]').click(); return true;})()`);
  await sleep(400);
  const collapsed = await ev(`(()=>{
    const el=${CARD_SEL};
    const toggle=el.querySelector('button[aria-expanded]');
    const desc=[...el.querySelectorAll('div')].find(d=>d.className.toString().includes('whitespace-pre-wrap'));
    return {ariaExpanded:toggle.getAttribute('aria-expanded'), clampBack:desc?desc.className.toString().includes('line-clamp-2'):null,
            chevronReset: !el.querySelector('.rotate-180')};
  })()`);
  console.log("  收起后:", JSON.stringify(collapsed));
}

// ---------- 5. 还原原视图 ----------
const origView = JSON.parse(before ?? "{}").view;
if (origView) {
  await ev(`localStorage.setItem('bixian.nav.view', ${JSON.stringify(origView)})`);
}
console.log("");
console.log("已还原 localStorage 视图偏好:", origView);

ws.close();
