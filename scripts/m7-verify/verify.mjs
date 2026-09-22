// M7 批次5 实机核验：分屏（左右/上下/关）、双窗格互不干扰、活动窗格跟随、
// 历史后退/前进（按钮 + Alt+←/→）、Alt+S 循环、打字机滚动（真实按键）、参考窗只读载入。
// 读原状态 → 核验 → 还原，不覆盖用户视图/书/打字机偏好。打字只落在隔离测试书 m7b5。
// 前置：node scripts/m7-verify/seed.mjs；app 以 --remote-debugging-port=9222 启动。
// 用法：node scripts/m7-verify/verify.mjs
const PORT = 9222;
const OUT = ".tmp-m7";

const { readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
const { bookId, jia: JIA_ID } = JSON.parse(
  readFileSync(join0(import.meta.dirname, "ids.json"), "utf8"),
);
function join0(a, b) {
  return a.replace(/[\\/]$/, "") + "/" + b;
}

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("找不到 page target：app 未以 --remote-debugging-port=9222 启动？");
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
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

const fails = [];
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` —— ${extra}` : ""}`);
  if (!ok) fails.push(name);
};

const capture = async (file) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`  截图 → ${file}`);
};
mkdirSync(OUT, { recursive: true });

const ready = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      const ok = await ev(
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

// 真实鼠标左键点击（坐标）
const clickAt = async (x, y) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
};
const clickEl = async (selJs) => {
  const box = await ev(
    `(()=>{const el=${selJs}; if(!el) return null; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)};})()`,
  );
  if (!box) return false;
  await clickAt(box.x, box.y);
  await sleep(300);
  return true;
};
// 修饰键：Alt=1, Ctrl=2
const key = async (opts) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", ...opts });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...opts });
  await sleep(120);
};
const altS = () => key({ modifiers: 1, key: "s", code: "KeyS", windowsVirtualKeyCode: 83 });
const altLeft = () =>
  key({ modifiers: 1, key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
const altRight = () =>
  key({ modifiers: 1, key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 37 });
const arrowDown = () =>
  key({ modifiers: 0, key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 });

// 侧栏章节行：div.cursor-pointer，行文本 = 章题 + 字数后缀（如「短章甲18 字」）。
// 以 去空白后 startWith 章题 + endsWith 字 识别；取最靠左的，避开 dock 同名元素。
const clickChapter = async (title) => {
  const ok = await ev(
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

// 分屏相关量测：PaneShell 容器（全库唯一 border-t-2），active 以 accent 边框类区分
const panesInfo = () =>
  ev(`[...document.querySelectorAll('div.border-t-2')].map(e=>{
      const r=e.getBoundingClientRect();
      return {x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height),
              active:e.className.includes('border-[color:var(--accent)]'),
              text:(e.textContent||'').slice(0,200)};
    })`);
const paneCount = async () => (await panesInfo()).length;

const topBarWordCount = () =>
  ev(`(()=>{
      const spans=[...document.querySelectorAll('span')].filter(s=>/^[\\d,]+ 字$/.test(s.textContent.trim()));
      const last=spans[spans.length-1];
      return last?parseInt(last.textContent.replace(/,/g,'')):null;
    })()`);

// ---------- 0. 就绪 + 读原状态（崩溃重跑时优先用上次快照，避免还原成污染值） ----------
if (!(await ready())) {
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
  before = await ev(
    `JSON.stringify({view:localStorage.getItem('bixian.nav.view'), last:localStorage.getItem('bixian.lastBookId'), tw:localStorage.getItem('bixian.typewriter')})`,
  );
  writeFileSync(join0(import.meta.dirname, "orig.json"), before);
}
console.log("原状态:", before);

// ---------- 1. 切到测试书 + 写作视图 ----------
await ev(
  `localStorage.setItem('bixian.nav.view','write'); localStorage.setItem('bixian.lastBookId','${bookId}');`,
);
await send("Page.reload");
await sleep(1500);
if (!(await ready())) {
  console.error("重载后未就绪");
  process.exit(1);
}
await sleep(800);

// ---------- 2. 默认单窗格 ----------
console.log("\n【默认单窗格】");
check("单窗格（无 PaneShell 容器）", (await paneCount()) === 0);
const picked = await clickChapter("短章甲");
check("点中短章甲行", picked);
check("正文进编辑器", await ev(`document.body.textContent.includes('山间小径泥泞')`));
check("分屏按钮存在（有章才有顶栏）", await ev(`!!document.querySelector('button[title*="分屏"]')`));

// ---------- 3. Alt+S → 左右分屏 ----------
console.log("\n【左右分屏】");
await altS();
await sleep(500);
let panes = await panesInfo();
check("出现两个窗格", panes.length === 2, JSON.stringify(panes.map((p) => [p.x, p.y])));
const sideBySide = panes.length === 2 && Math.abs(panes[0].y - panes[1].y) < 5 && panes[0].x < panes[1].x;
check("左右并排（同一行、a 在左）", sideBySide, JSON.stringify(panes.map((p) => [p.x, p.y])));
check("active 标记只在窗格 a", panes[0]?.active === true && panes[1]?.active === false,
  JSON.stringify(panes.map((p) => p.active)));
await capture(`${OUT}/01-split-vertical.png`);

// ---------- 4. 焦点跟随 + 双窗格互不干扰 ----------
console.log("\n【焦点与互不干扰】");
// 点窗格 b 空态
panes = await panesInfo();
const bBox = { x: Math.round(panes[1].x + panes[1].w / 2), y: Math.round(panes[1].y + panes[1].h / 2) };
await clickAt(bBox.x, bBox.y);
await sleep(400);
panes = await panesInfo();
check("点击窗格 b 后焦点跟随", panes[0]?.active === false && panes[1]?.active === true,
  JSON.stringify(panes.map((p) => p.active)));

await clickChapter("短章乙");
panes = await panesInfo();
check("短章乙装进窗格 b", panes[1]?.text.includes("渡口的灯笼"), panes[1]?.text.slice(0, 40));
check("窗格 a 仍是短章甲（槽位独立）", panes[0]?.text.includes("山间小径泥泞"), panes[0]?.text.slice(0, 40));
await capture(`${OUT}/02-both-panes.png`);

// ---------- 5. 历史：按钮 + 快捷键 ----------
console.log("\n【历史导航】");
await clickChapter("长章");
check("窗格 b 打开长章", (await panesInfo())[1]?.text.includes("山风掠过檐角"));

const backBtn = `document.querySelector('button[title="后退（Alt+←）"]')`;
const fwdBtn = `document.querySelector('button[title="前进（Alt+→）"]')`;
check("后退可用", await ev(`!${backBtn}.disabled`));
await clickEl(backBtn);
check("后退到短章乙", (await panesInfo())[1]?.text.includes("渡口的灯笼"));
await clickEl(fwdBtn);
check("前进回长章", (await panesInfo())[1]?.text.includes("山风掠过檐角"));
await altLeft();
check("Alt+← 后退生效", (await panesInfo())[1]?.text.includes("渡口的灯笼"));
await altRight();
check("Alt+→ 前进生效", (await panesInfo())[1]?.text.includes("山风掠过檐角"));

// ---------- 6. Alt+S → 上下分屏 → 关闭 ----------
console.log("\n【上下分屏与关闭】");
await altS();
await sleep(500);
panes = await panesInfo();
const stacked = panes.length === 2 && Math.abs(panes[0].x - panes[1].x) < 5 && panes[0].y < panes[1].y;
check("上下堆叠（同列、a 在上）", stacked, JSON.stringify(panes.map((p) => [p.x, p.y])));
check("上格仍是短章甲", panes[0]?.text.includes("山间小径泥泞"));
check("下格是长章（b 的导航不牵连 a）", panes[1]?.text.includes("山风掠过檐角"));
await capture(`${OUT}/03-split-horizontal.png`);

await altS();
await sleep(500);
check("再按 Alt+S 回到单窗格", (await paneCount()) === 0);
check("收分屏后回到窗格 a 的短章甲", await ev(`document.body.textContent.includes('山间小径泥泞')`));

// ---------- 7. 打字机滚动（真实按键） ----------
console.log("\n【打字机】");
await clickChapter("长章");
await sleep(400);
// 开打字机
await clickEl(`document.querySelector('button[title*="打字机"]')`);
await sleep(300);
check(
  "开关写入 localStorage",
  (await ev(`localStorage.getItem('bixian.typewriter')`)) === "1",
);

// 真实点击第一段开头，光标落正文顶部
const firstPara = await ev(
  `(()=>{const pm=document.querySelector('.ProseMirror'); const p=pm && pm.firstElementChild;
     if(!p) return null; const r=p.getBoundingClientRect(); return {x:Math.round(r.left+8), y:Math.round(r.top+r.height/2)};})()`,
);
if (!firstPara) {
  check("编辑器已挂载", false);
} else {
  await clickAt(firstPara.x, firstPara.y);
  await sleep(300);
  // 连按 ↓ 60 次：光标下移约 60 段，触发 selectionSet 打字机滚动
  for (let i = 0; i < 60; i++) await arrowDown();
  await sleep(400);
  const sc = await ev(
    `(()=>{const el=document.querySelector('.ProseMirror').closest('.overflow-y-auto');
       const sr=el.getBoundingClientRect();
       const sel=window.getSelection(); const cr=sel.rangeCount?sel.getRangeAt(0).getBoundingClientRect():null;
       return {scrollTop:el.scrollTop, scTop:sr.top, scH:sr.height, caretTop:cr?cr.top:null};})()`,
  );
  check("光标下移触发滚动", sc.scrollTop > 200, `scrollTop=${Math.round(sc.scrollTop)}`);
  const inBand = sc.caretTop != null && sc.caretTop >= sc.scTop && sc.caretTop <= sc.scTop + sc.scH * 0.75;
  check("光标保持在视口上部（40% 锚点附近）", inBand, `caretTop=${sc.caretTop} scTop=${sc.scTop} scH=${sc.scH}`);

  // 输入触发 docChanged 路径 + 字数统计
  const beforeType = await topBarWordCount();
  await send("Input.insertText", { text: "灯下草稿" });
  await sleep(600);
  const afterType = await topBarWordCount();
  check("输入后字数 +4", beforeType != null && afterType === beforeType + 4, `${beforeType} → ${afterType}`);
  await capture(`${OUT}/04-typewriter.png`);
}
// 关打字机（还原为关）
await clickEl(`document.querySelector('button[title*="打字机"]')`);
await sleep(200);
check(
  "关后 localStorage 复位",
  (await ev(`localStorage.getItem('bixian.typewriter')`)) === "0",
);

// ---------- 8. 参考窗（dock 只读） ----------
console.log("\n【参考窗】");
// dock 若折叠先展开
await ev(
  `(()=>{const b=document.querySelector('button[title="展开右侧面板（Ctrl+\\\\）"]'); if(b) b.click();})()`,
);
await sleep(300);
await clickEl(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='参考')`);
await sleep(500);
// 选短章甲进参考窗（编辑器当前是长章，山间小径出现即来自参考窗）
await ev(
  `(()=>{const sel=document.querySelector('select[data-testid="ref-chapter-select"]'); if(!sel) return false;
     const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;
     setter.call(sel,'${JIA_ID}'); sel.dispatchEvent(new Event('change',{bubbles:true})); return true;})()`,
);
await sleep(800);
check("参考窗载入短章甲正文", await ev(`document.body.textContent.includes('山间小径泥泞')`));
// 单窗格模式下全页只有编辑器一个 .ProseMirror；参考窗若挂了编辑器会变成 2
const pmCount = await ev(`document.querySelectorAll('.ProseMirror').length`);
check("参考窗无编辑器（只读）", pmCount === 1, `ProseMirror 数=${pmCount}`);
await capture(`${OUT}/05-ref-dock.png`);

// ---------- 9. 还原用户状态 ----------
console.log("\n【还原】");
const orig = JSON.parse(before ?? "{}");
await ev(
  `(()=>{${orig.view != null ? `localStorage.setItem('bixian.nav.view',${JSON.stringify(orig.view)});` : `localStorage.removeItem('bixian.nav.view');`}
    ${orig.last != null ? `localStorage.setItem('bixian.lastBookId',${JSON.stringify(orig.last)});` : `localStorage.removeItem('bixian.lastBookId');`}
    ${orig.tw != null ? `localStorage.setItem('bixian.typewriter',${JSON.stringify(orig.tw)});` : `localStorage.removeItem('bixian.typewriter');`}
    return true;})()`,
);
await send("Page.reload");
await sleep(1200);
await ready();
console.log("已还原视图/书/打字机偏好:", JSON.stringify(orig));

ws.close();
console.log(`\n==== 核验完成：${fails.length === 0 ? "全部通过" : fails.length + " 项失败"} ====`);
if (fails.length) {
  console.log("失败项:", fails.join("；"));
  process.exit(1);
}
// 全过才清快照（失败保留，供重跑还原真值）
const { rmSync } = await import("node:fs");
rmSync(join0(import.meta.dirname, "orig.json"), { force: true });