// M7 批次7 实机核验：自定义字段（建档/选值/刷新后仍在 DB）、取名生成器（生成/约束）、
// 卡片墙自由摆位（模式切换/落序按钮）、参考窗弹出 OS 浮窗（第二 page target 载入正文后关闭）。
// 读原状态 → 核验 → 还原；写入只落在隔离测试书 m7b7（cleanup.mjs 连书带字段一起清）。
// 前置：node scripts/m7b7-verify/seed.mjs；app 以 CDP 9222 启动。
// 用法：node scripts/m7b7-verify/verify.mjs
const PORT = 9222;
const OUT = ".tmp-m7b7";

const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
function join0(a, b) {
  return a.replace(/[\\/]$/, "") + "/" + b;
}
const { bookId, jia: JIA_ID, yi: YI_ID } = JSON.parse(
  readFileSync(join0(import.meta.dirname, "ids.json"), "utf8"),
);

// ---- CDP 连接工厂（主窗 + 参考浮窗各一条） ----
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let mid = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) => {
    const id = ++mid;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((r) => {
      const t = setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          r({ __timeout: true });
        }
      }, 15000);
      pending.set(id, (m) => {
        clearTimeout(t);
        r(m);
      });
    });
  };
  const ready = new Promise((r) => (ws.onopen = r));
  const ev = async (expression) => {
    await ready;
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
  return { ws, send, ev, ready, close: () => ws.close() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` —— ${extra}` : ""}`);
  if (!ok) fails.push(name);
};

const listTargets = async () => (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json());

const mainInfo = (await listTargets()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!mainInfo) {
  console.error("找不到主窗 page target：app 未以 CDP 9222 启动？");
  process.exit(1);
}
const c = connect(mainInfo.webSocketDebuggerUrl);
await c.ready;
await c.send("Runtime.enable");
await c.send("Page.enable");

const captureTo = async (conn, file) => {
  const shot = await conn.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`  截图 → ${file}`);
};
mkdirSync(OUT, { recursive: true });

// 真实鼠标点击（触发 React 合成事件 + :hover）；先 scrollIntoView——
// dock 面板可滚动，折叠线下方的元素 rect 超出视口，直接按坐标点会落空（实机核验踩过）。
const clickEl = async (selJs) => {
  const box = await c.ev(
    `(()=>{const el=${selJs}; if(!el) return null; el.scrollIntoView({block:'center'}); const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`,
  );
  if (!box) return false;
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(350);
  return true;
};
// 点击定位后用真实按键输入（触发 React onChange）
const typeInto = async (selJs, text) => {
  const ok = await clickEl(selJs);
  if (!ok) return false;
  await c.send("Input.insertText", { text });
  await sleep(200);
  return true;
};
// React 受控 select：原生 setter 赋值 + change 冒泡
const setSelect = (selJs, value) =>
  c.ev(
    `(()=>{const sel=${selJs}; if(!sel) return false;
       const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
       setter.call(sel,${JSON.stringify(value)}); sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`,
  );

const clickChapter = async (title) => {
  const ok = await c.ev(
    `(()=>{const rows=[...document.querySelectorAll('div.cursor-pointer')].filter(e=>{
        const t=e.textContent.replace(/\\s/g,'');
        return t.startsWith(${JSON.stringify(title)}) && t.endsWith('字');
      });
      if(!rows.length) return false;
      rows.sort((a,b)=>a.getBoundingClientRect().left-b.getBoundingClientRect().left)[0].click();
      return true;})()`,
  );
  await sleep(600);
  return ok;
};

const appReady = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const ok = await c.ev(
        `!!(document.getElementById('root')?.children.length && getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() && document.querySelector('main'))`,
      );
      if (ok === true) return true;
    } catch {
      /* 导航中执行上下文销毁，重试 */
    }
    await sleep(500);
  }
  return false;
};

// ---------- 0. 就绪 + 读原状态（失败重跑时复用快照，还原真值） ----------
if (!(await appReady())) {
  console.error("应用未就绪（超时）");
  process.exit(1);
}
let before = null;
try {
  before = readFileSync(join0(import.meta.dirname, "orig.json"), "utf8");
  console.log("复用上次快照:", before);
} catch {
  /* 首跑 */
}
if (!before) {
  before = await c.ev(
    `JSON.stringify({view:localStorage.getItem('bixian.nav.view'), last:localStorage.getItem('bixian.lastBookId'), struct:localStorage.getItem('bixian.structureMode'), cork:localStorage.getItem('bixian.corkboardMode')})`,
  );
  writeFileSync(join0(import.meta.dirname, "orig.json"), before);
}
console.log("原状态:", before);

// ---------- 1. 切到测试书 ----------
await c.ev(
  `localStorage.setItem('bixian.nav.view','write'); localStorage.setItem('bixian.lastBookId','${bookId}');`,
);
await c.send("Page.reload");
await sleep(1500);
if (!(await appReady())) {
  console.error("重载后未就绪");
  process.exit(1);
}
await sleep(600);
check("测试书已加载（侧栏出现短章甲）", await clickChapter("短章甲"));

// ---------- 2. 自定义字段：建档（list 型）→ 选值 → 刷新仍在 ----------
console.log("\n【自定义字段】");
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='元数据')`);
await sleep(500);
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='管理定义')`);
await sleep(400);
check(
  "新字段名输入框出现",
  await c.ev(`!!document.querySelector('input[placeholder="新字段名…"]')`),
);
await typeInto(`document.querySelector('input[placeholder="新字段名…"]')`, "主线");
await setSelect(`document.querySelector('select[aria-label="字段类型"]')`, "list");
await sleep(200);
await typeInto(`document.querySelector('input[placeholder="新字段的选项，逗号分隔"]')`, "红，蓝");
await clickEl(`document.querySelector('button[title="新增字段"]')`);
await sleep(800);
check(
  "list 型字段编辑器渲染（含 红/蓝 选项）",
  await c.ev(
    `(()=>{const sel=[...document.querySelectorAll('select[data-testid^="custom-value-"]')].find(s=>[...s.options].some(o=>o.textContent==='红'));
       return !!sel && [...sel.options].some(o=>o.textContent==='蓝');})()`,
  ),
);
// 选「蓝」
await c.ev(
  `(()=>{const sel=[...document.querySelectorAll('select[data-testid^="custom-value-"]')].find(s=>[...s.options].some(o=>o.textContent==='红'));
     if(!sel) return false;
     const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
     setter.call(sel,'蓝'); sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`,
);
await sleep(800);
await captureTo(c, `${OUT}/01-custom-field.png`);
// 刷新验证 DB 落库（reload 后无选中章，先重选短章甲，元数据面板才渲染值编辑器）
await c.send("Page.reload");
await sleep(1500);
await appReady();
await sleep(600);
await clickChapter("短章甲");
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='元数据')`);
await sleep(500);
check(
  "刷新后字段值仍在（DB 落库）",
  await c.ev(
    `(()=>{const sel=[...document.querySelectorAll('select[data-testid^="custom-value-"]')].find(s=>[...s.options].some(o=>o.textContent==='红'));
       return sel && sel.value==='蓝';})()`,
  ),
);

// ---------- 3. 取名生成器 ----------
console.log("\n【取名】");
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='取名')`);
await sleep(500);
check("取名面板渲染", await c.ev(`!!document.querySelector('[data-testid="names-panel"]')`));
await setSelect(`document.querySelector('select[aria-label="性别"]')`, "female");
await clickEl(`document.querySelector('[data-testid="names-generate"]')`);
await sleep(1000);
const gen = await c.ev(
  `(()=>{const cards=[...document.querySelectorAll('[data-testid="names-result"]')];
     return {n:cards.length, labels:cards.map(x=>x.textContent).join('|')};})()`,
);
check("生成一批名字", gen && gen.n > 0, JSON.stringify(gen)?.slice(0, 120));
check("性别约束生效（无男名）", gen && gen.labels.indexOf("男") === -1, gen?.labels?.slice(0, 60));
await captureTo(c, `${OUT}/02-names.png`);

// ---------- 4. 自由摆位 ----------
console.log("\n【自由摆位】");
await c.ev(`localStorage.setItem('bixian.nav.view','structure');`);
await c.send("Page.reload");
await sleep(1500);
await appReady();
await sleep(600);
await clickEl(`document.querySelector('[data-testid="corkboard-mode-freeform"]')`);
await sleep(800);
check("自由摆位画布出现", await c.ev(`!!document.querySelector('[data-testid="corkboard-freeform-canvas"]')`));
check(
  "三张卡绝对定位",
  (await c.ev(`document.querySelectorAll('[data-testid="corkboard-freeform-canvas"] div.absolute').length`)) === 3,
);
check("落序按钮存在", await c.ev(`!!document.querySelector('[data-testid="corkboard-commit"]')`));
await captureTo(c, `${OUT}/03-freeform.png`);
await clickEl(`document.querySelector('[data-testid="corkboard-commit"]')`);
await sleep(800);
const order = await c.ev(
  `(()=>{const gc=new Intl.Collator('zh'); return [...document.querySelectorAll('div.cursor-pointer')].map(e=>e.textContent.replace(/\\s/g,'')).filter(t=>t.startsWith('短章')).join('|');})()`,
);
check("落序不报错、卡片仍在", typeof order === "string" && order.includes("短章"), order);
await clickEl(`document.querySelector('[data-testid="corkboard-mode-grid"]')`);
await sleep(400);
check(
  "切回排序网格",
  await c.ev(`!!document.querySelector('div.h-32')`),
);

// ---------- 5. 参考窗弹出 OS 浮窗 ----------
console.log("\n【OS 参考浮窗】");
await c.ev(`localStorage.setItem('bixian.nav.view','write');`);
await c.send("Page.reload");
await sleep(1500);
await appReady();
await sleep(600);
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='参考')`);
await sleep(500);
await c.ev(
  `(()=>{const sel=document.querySelector('select[data-testid="ref-chapter-select"]'); if(!sel) return false;
     const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
     setter.call(sel,'${YI_ID}'); sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`,
);
await sleep(800);
check("弹出按钮可用", await c.ev(`(()=>{const b=document.querySelector('[data-testid="ref-popout"]'); return b && !b.disabled;})()`));
await clickEl(`document.querySelector('[data-testid="ref-popout"]')`);
// 轮询第二 page target
let refInfo = null;
for (let i = 0; i < 20; i++) {
  const targets = await listTargets();
  refInfo = targets.find((t) => t.type === "page" && (t.url || "").includes("refwindow"));
  if (refInfo) break;
  await sleep(500);
}
check("OS 浮窗出现（?refwindow target）", !!refInfo, refInfo ? refInfo.url.slice(-40) : "未找到");
if (refInfo) {
  const r = connect(refInfo.webSocketDebuggerUrl);
  await r.ready;
  await r.send("Runtime.enable");
  await r.send("Page.enable");
  let refOk = false;
  for (let i = 0; i < 20; i++) {
    try {
      refOk = await r.ev(
        `!!(document.querySelector('[data-testid="ref-window"]') && document.body.textContent.includes('渡口的灯笼'))`,
      );
      if (refOk === true) break;
    } catch {
      /* 浮窗前端还在起 */
    }
    await sleep(500);
  }
  check("浮窗载入短章乙正文", refOk === true);
  // 标题在内容就绪后再查：target 一出现时 React 可能还没挂载 document.title
  const refNow = (await listTargets()).find((t) => t.type === "page" && (t.url || "").includes("refwindow"));
  check("浮窗标题", (refNow?.title || "").includes("参考"), refNow?.title);
  const selVal = await r.ev(
    `(()=>{const sel=document.querySelector('[data-testid="ref-window-chapter-select"]'); return sel?sel.value:null;})()`,
  );
  check("浮窗初值 = 弹出时所选章", selVal === String(YI_ID), `sel=${selVal} 期望=${YI_ID}`);
  await captureTo(r, `${OUT}/04-ref-os-window.png`);
  // 浮窗内切章
  await r.ev(
    `(()=>{const sel=document.querySelector('[data-testid="ref-window-chapter-select"]');
       const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
       setter.call(sel,'${JIA_ID}'); sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`,
  );
  await sleep(800);
  check(
    "浮窗内切章生效",
    await r.ev(`document.body.textContent.includes('山间小径泥泞')`),
  );
  r.close();
  // 关浮窗：走 /json/close
  await fetch(`http://127.0.0.1:${PORT}/json/close/${refInfo.id}`);
  await sleep(800);
  const after = await listTargets();
  check("浮窗已关闭", !after.some((t) => (t.url || "").includes("refwindow")));
  check("主窗仍在", after.some((t) => t.type === "page" && t.webSocketDebuggerUrl));
}

// ---------- 6. 还原用户状态 ----------
console.log("\n【还原】");
const orig = JSON.parse(before ?? "{}");
await c.ev(
  `(()=>{${orig.view != null ? `localStorage.setItem('bixian.nav.view',${JSON.stringify(orig.view)});` : `localStorage.removeItem('bixian.nav.view');`}
    ${orig.last != null ? `localStorage.setItem('bixian.lastBookId',${JSON.stringify(orig.last)});` : `localStorage.removeItem('bixian.lastBookId');`}
    ${orig.struct != null ? `localStorage.setItem('bixian.structureMode',${JSON.stringify(orig.struct)});` : `localStorage.removeItem('bixian.structureMode');`}
    ${orig.cork != null ? `localStorage.setItem('bixian.corkboardMode',${JSON.stringify(orig.cork)});` : `localStorage.removeItem('bixian.corkboardMode');`}
    return true;})()`,
);
await c.send("Page.reload");
await sleep(1200);
await appReady();
console.log("已还原视图/书/摆位偏好:", JSON.stringify(orig));

c.close();
console.log(`\n==== 核验完成：${fails.length === 0 ? "全部通过" : fails.length + " 项失败"} ====`);
if (fails.length) {
  console.log("失败项:", fails.join("；"));
  process.exit(1);
}
// 全过才清快照（失败保留，供重跑还原真值）
const { rmSync } = await import("node:fs");
rmSync(join0(import.meta.dirname, "orig.json"), { force: true });
