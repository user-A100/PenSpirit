// CDP 验证：--bg-backdrop 派生（Task 7）——4 个暗色主题逐个切换，
// 断言背板比内容浮卡（--bg-panel）逐通道深 ≥8，结尾还原用户原主题。
// 用法：node scripts/zen-verify/verify-backdrop.mjs
const PORT = 9222;

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
  const r = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (r.error) return { __err: r.error.message };
  const ro = r.result?.result;
  if (ro?.subtype === "error") return { __err: ro.description };
  return ro?.value;
}

const list = await targets();
const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) {
  console.error("找不到 page target：app 未以 --remote-debugging-port=9222 启动？");
  process.exit(1);
}
const cdp = await connect(page.webSocketDebuggerUrl);
await cdp.send("Runtime.enable");

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

// 打开设置 → 外观 tab；返回当前「使用中」主题名
const openAppearance = () => evalJs(
  cdp,
  `(async () => {
     document.querySelector('button[title="设置"]')?.click();
     await new Promise(r => setTimeout(r, 250));
     const bd = document.querySelector('[data-testid="settings-backdrop"]');
     if (!bd) return { __err: 'settings-backdrop 未渲染' };
     [...bd.querySelectorAll('button')].find(b => b.textContent.trim() === '外观')?.click();
     await new Promise(r => setTimeout(r, 250));
     const cards = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'));
     return { current: cards.map(c => c.textContent.match(/([^\\s]+)使用中$/)?.[1]).find(Boolean) ?? null };
   })()`,
);

const clickTheme = (name) => evalJs(
  cdp,
  `(async () => {
     const card = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'))
       .find(c => c.textContent.includes(${JSON.stringify(name)}));
     if (!card) return { __err: 'card not found: ' + ${JSON.stringify(name)} };
     card.click();
     await new Promise(r => setTimeout(r, 250));
     const s = getComputedStyle(document.documentElement);
     return { backdrop: s.getPropertyValue('--bg-backdrop').trim(),
              panel: s.getPropertyValue('--bg-panel').trim() };
   })()`,
);

const closeSettings = () => evalJs(
  cdp,
  `(async () => {
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
     await new Promise(r => setTimeout(r, 200));
     return !document.querySelector('[data-testid="settings-backdrop"]');
   })()`,
);

const parseColor = (v) => {
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [1, 3, 5].map((i) => parseInt(hex[1].slice(i - 1, i + 1), 16));
  const rgb = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
};

const opened = await openAppearance();
if (opened?.__err) {
  console.error("打开设置失败：", JSON.stringify(opened));
  process.exit(1);
}
const originalTheme = opened.current;
console.log(`当前主题：${originalTheme ?? "(未识别)"}（结尾还原）`);

for (const name of ["墨岩", "暗夜", "午夜蓝", "枫夜"]) {
  const r = await clickTheme(name);
  if (r?.__err) {
    check(`${name} 背板差`, false, JSON.stringify(r));
    continue;
  }
  const bd = parseColor(r.backdrop);
  const pn = parseColor(r.panel);
  if (!bd || !pn) {
    check(`${name} 背板差`, false, `解析失败 backdrop=${r.backdrop} panel=${r.panel}`);
    continue;
  }
  const diffs = bd.map((v, i) => pn[i] - v); // 正值 = 背板更暗
  const minDiff = Math.min(...diffs);
  check(
    `${name} 背板比浮卡逐通道深 ≥8`,
    diffs.every((d) => d >= 8),
    `backdrop=${r.backdrop} panel=${r.panel} 通道差=[${diffs.join(",")}] 最小=${minDiff}`,
  );
}

// 还原（设置此刻仍开着）
if (originalTheme) {
  const back = await clickTheme(originalTheme);
  check(`还原原主题（${originalTheme}）`, !!back?.backdrop && !back?.__err, JSON.stringify(back));
}
check("设置弹窗关闭", (await closeSettings()) === true);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
cdp.close();
process.exit(failed.length ? 1 : 0);
