// M5 图谱实机核验：走查 家族树/关系网络/地图 三 tab + 关系现场建 + 地图 asset 渲染 + 人物卡 Badge。
// 前置：node seed.mjs <图> 后以 CDP 启动 app；本脚本只读用户偏好并在结束时还原当前书。
// 用法：node scripts/m5-verify/verify.mjs
const PORT = 9222;
const IDS = JSON.parse(
  await import("node:fs").then((fs) => fs.readFileSync(new URL("./ids.json", import.meta.url), "utf8")),
);
const BOOK_TITLE = "M5核验";

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };
    ws.onerror = reject;
    ws.onopen = () =>
      resolve({
        send(method, params = {}) {
          const mid = ++id;
          ws.send(JSON.stringify({ id: mid, method, params }));
          return new Promise((res) => pending.set(mid, res));
        },
        close: () => ws.close(),
      });
  });
}

async function evalJs(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.error) return { __err: r.error.message };
  const ro = r.result?.result;
  if (ro?.subtype === "error") return { __err: ro.description };
  return ro?.value;
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const list = await targets();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("找不到 page target：app 未以 --remote-debugging-port=9222 启动？");
  process.exit(1);
}
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

// 注入到页面的公共工具：等元素 / React 受控输入赋值 / 点按
const HELPERS = `
window.__m5 = {
  sleep: (ms) => new Promise(r => setTimeout(r, ms)),
  async until(fn, ms = 3000) {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > ms) return null;
      await new Promise(r => setTimeout(r, 60));
    }
  },
  byText: (sel, text) => [...document.querySelectorAll(sel)].find(e => e.textContent.trim().includes(text)),
  setInput(el, val) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(proto.prototype, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  },
  setSelect(el, val) {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, String(val));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  },
};
true`;
await evalJs(cdp, HELPERS);

const booted = await evalJs(cdp, `!!document.querySelector('#root')?.children.length`);
if (booted !== true) {
  console.error("app 未加载出前端");
  process.exit(1);
}

// 0. 记录原状：当前书 + 主题色（收尾还原，不覆盖用户偏好）
const original = await evalJs(
  cdp,
  `(() => { const s = getComputedStyle(document.documentElement);
     return { bookId: localStorage.getItem('bixian.lastBookId'),
              accent: s.getPropertyValue('--accent').trim(),
              panel: s.getPropertyValue('--bg-panel').trim() }; })()`,
);
console.log("原状:", JSON.stringify(original));

// 1. 切到隔离测试书
const bookPicked = await evalJs(
  cdp,
  `(async () => {
     const row = window.__m5.byText('div.cursor-pointer', ${JSON.stringify(BOOK_TITLE)});
     if (!row) return { __err: '侧栏找不到「${BOOK_TITLE}」书行' };
     row.click();
     await window.__m5.sleep(600);
     return { bookId: localStorage.getItem('bixian.lastBookId') };
   })()`,
);
check("切到隔离测试书", bookPicked?.bookId === String(IDS.bookId), JSON.stringify(bookPicked));

// 2. 图谱视图入口 + 家族树初始（无关系 → 全员未入谱）
const graphEntry = await evalJs(
  cdp,
  `(async () => {
     const btn = document.querySelector('button[title="图谱"]');
     if (!btn) return { __err: 'Ribbon 无「图谱」按钮' };
     btn.click();
     await window.__m5.sleep(500);
     const nodes = await window.__m5.until(() => {
       const n = document.querySelectorAll('[data-testid^="tree-node-"]');
       return n.length ? n : null;
     });
     return { tabs: ['tree','network','map'].filter(t => document.querySelector('[data-testid="graph-tab-'+t+'"]')),
              nodes: nodes ? nodes.length : 0,
              hasCanvas: !!document.querySelector('[data-testid="tree-canvas"]') };
   })()`,
);
check("图谱一级视图：三 tab + 家族树画布",
  graphEntry && graphEntry.tabs?.length === 3 && graphEntry.hasCanvas === true,
  JSON.stringify(graphEntry));
check("无关系时三角色全部渲染（未入谱行）", graphEntry?.nodes === 3, `nodes=${graphEntry?.nodes}`);

// 3. 现场建关系：林远山(2)-配偶-苏婉(3)，再 林远山(2)-父母-林小晚(4)
const relCreated = await evalJs(
  cdp,
  `(async () => {
     const make = async (sourceId, preset, targetId) => {
       const src = document.querySelector('[data-testid="tree-node-' + sourceId + '"]');
       if (!src) return 'no-source-' + sourceId;
       src.dispatchEvent(new MouseEvent('click', { bubbles: true }));
       const modal = await window.__m5.until(() => document.querySelector('[data-testid="relation-modal"]'));
       if (!modal) return 'no-modal';
       const chip = document.querySelector('[data-testid="rel-preset-' + preset + '"]');
       if (!chip) return 'no-preset-' + preset;
       chip.click();
       const sel = await window.__m5.until(() => document.querySelector('[data-testid="rel-target"]'));
       if (!sel) return 'no-target-select';
       window.__m5.setSelect(sel, targetId);
       await window.__m5.sleep(120);
       const save = document.querySelector('[data-testid="rel-save"]');
       if (!save || save.disabled) return 'save-disabled';
       save.click();
       await window.__m5.until(() => !document.querySelector('[data-testid="relation-modal"]'));
       await window.__m5.sleep(400);
       return 'ok';
     };
     return { spouse: await make(${IDS.father}, '配偶', ${IDS.mother}), parent: await make(${IDS.father}, '父母', ${IDS.child}) };
   })()`,
);
check("现场建关系（配偶 + 父母）成功",
  relCreated?.spouse === "ok" && relCreated?.parent === "ok",
  JSON.stringify(relCreated));

// 4. 家族树分层：夫妻并排同代，子女下一层且挂在中点
const treeLayout = await evalJs(
  cdp,
  `(() => {
     const rect = (id) => document.querySelector('[data-testid="tree-node-' + id + '"] rect');
     const f = rect(${IDS.father}), m = rect(${IDS.mother}), c = rect(${IDS.child});
     if (!f || !m || !c) return { __err: '节点缺失', has: { f: !!f, m: !!m, c: !!c } };
     const g = (r) => ({ x: +r.getAttribute('x'), y: +r.getAttribute('y'), w: +r.getAttribute('width') });
     const [F, M, C] = [g(f), g(m), g(c)];
     return { f: F, m: M, c: C,
              sameTier: F.y === M.y,
              adjacent: M.x === F.x + F.w + 28,
              childBelow: C.y > F.y,
              childCentered: Math.abs((C.x + C.w/2) - ((F.x + F.w/2 + M.x + M.w/2) / 2)) < 1 };
   })()`,
);
check("家族树：夫妻并排同代 + 子女居中挂下一层",
  treeLayout && treeLayout.sameTier && treeLayout.adjacent && treeLayout.childBelow && treeLayout.childCentered,
  JSON.stringify(treeLayout));

// 5. 关系网络 tab：两条边
const network = await evalJs(
  cdp,
  `(async () => {
     document.querySelector('[data-testid="graph-tab-network"]').click();
     await window.__m5.sleep(500);
     return { edges: document.querySelectorAll('[data-testid^="rel-edge-"]').length,
              nodes: document.querySelectorAll('[data-testid^="rel-node-"]').length };
   })()`,
);
check("关系网络：2 条边 / 3 个节点",
  network?.edges === 2 && network?.nodes === 3, JSON.stringify(network));

// 6. 地图 tab：asset 协议底图真的解码出来 + pin 按百分比落位
const mapTab = await evalJs(
  cdp,
  `(async () => {
     document.querySelector('[data-testid="graph-tab-map"]').click();
     await window.__m5.sleep(800);
     const img = await window.__m5.until(() => {
       const i = document.querySelector('[data-testid="map-surface"] img');
       return i && i.naturalWidth > 0 ? i : null;
     }, 5000);
     const pin = document.querySelector('[data-testid^="map-pin-"]');
     return { src: img ? img.getAttribute('src').slice(0, 40) : null,
              decoded: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
              pinLeft: pin ? pin.style.left : null,
              pinTop: pin ? pin.style.top : null,
              pinLabel: pin ? pin.textContent.trim() : null };
   })()`,
);
check("地图：asset 协议底图成功解码",
  mapTab?.decoded?.w > 0, JSON.stringify(mapTab?.decoded) + " src=" + mapTab?.src);
check("地图：pin 按百分比落位（30% / 40%）",
  mapTab?.pinLeft === "30%" && mapTab?.pinTop === "40%",
  `left=${mapTab?.pinLeft} top=${mapTab?.pinTop} label=${mapTab?.pinLabel}`);

// 7. 暗色主题下颜色走 CSS 变量（无写死色值突兀）
const themed = await evalJs(
  cdp,
  `(() => {
     const s = getComputedStyle(document.documentElement);
     const pin = document.querySelector('[data-testid^="map-pin-"] span');
     const edge = document.querySelector('[data-testid^="rel-edge-"] line');
     return { accent: s.getPropertyValue('--accent').trim(),
              pinColor: pin ? getComputedStyle(pin).color : null,
              pinBg: pin ? getComputedStyle(pin).backgroundColor : null,
              edgeStroke: edge ? edge.getAttribute('stroke') : '(网络 tab 已卸载)' };
   })()`,
);
check("主题变量已注入且 pin 颜色非空",
  themed && themed.accent?.length > 0 && themed.pinColor && themed.pinColor !== "rgba(0, 0, 0, 0)",
  JSON.stringify(themed));

// 8. 人物卡关系数 Badge（写作视图 → 人物 dock tab）
const badge = await evalJs(
  cdp,
  `(async () => {
     document.querySelector('button[title="写作"]').click();
     await window.__m5.sleep(400);
     const tab = window.__m5.byText('button', '人物');
     if (!tab) return { __err: 'dock 无「人物」tab' };
     tab.click();
     await window.__m5.sleep(700);
     const cards = [...document.querySelectorAll('div')].filter(d =>
       d.className.includes('group') && d.textContent.includes('关系'));
     const found = [...document.querySelectorAll('span')].filter(s => /^\\d+ 关系$/.test(s.textContent.trim()));
     return { badges: found.map(s => s.textContent.trim()),
              names: cards.map(c => c.textContent.slice(0, 12)) };
   })()`,
);
check("人物卡关系数 Badge：林远山 2 / 苏婉 1 / 林小晚 1",
  badge && JSON.stringify(badge.badges?.slice().sort()) === JSON.stringify(["1 关系", "1 关系", "2 关系"]),
  JSON.stringify(badge?.badges));

// 9. 还原原书（不覆盖用户当前选择）
const originalTitle = await (async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { join } = await import("node:path");
  const db = new DatabaseSync(join(process.env.APPDATA, "com.bixian.app", "bixian.db"));
  const row = db.prepare("SELECT title FROM books WHERE id = ?").get(Number(original.bookId));
  return row?.title ?? null;
})();
const restored = await evalJs(
  cdp,
  `(async () => {
     const row = window.__m5.byText('div.cursor-pointer', ${JSON.stringify(originalTitle)});
     if (!row) return { __err: '原书行未找到: ' + ${JSON.stringify(originalTitle)} };
     row.click();
     await window.__m5.sleep(600);
     return { bookId: localStorage.getItem('bixian.lastBookId') };
   })()`,
);
check(`还原原书选择（${originalTitle}）`, restored?.bookId === original.bookId, JSON.stringify(restored));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
cdp.close();
process.exit(failed.length ? 1 : 0);
