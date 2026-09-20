// CDP 验证：Zen 主题对 + 组件统一（P1+P2）。
// 生产构建下无 /src 源码路径，全部走 DOM/UI 路径验证。
// 用法：node scripts/zen-verify/verify.mjs
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

// Runtime.evaluate 的返回值嵌在 result.result.value（不是 result.value）
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

const booted = await evalJs(cdp, `!!document.querySelector('#root')?.children.length`);
if (booted !== true) {
  console.error("app 未加载出 Tauri internals");
  process.exit(1);
}

// 1. Zen 结构 token 已注入 :root
const tokens = await evalJs(
  cdp,
  `(() => { const s = getComputedStyle(document.documentElement);
     const keys = ['--radius-sm','--radius-md','--radius-lg','--shadow-pop','--dur-fast','--dur-md','--tab-selected-bg'];
     const missing = keys.filter(k => !s.getPropertyValue(k).trim());
     return { missing, radius: s.getPropertyValue('--radius-lg').trim(), shadow: s.getPropertyValue('--shadow-pop').trim() };
   })()`,
);
check("Zen 结构 token 全部注入 :root",
  tokens && tokens.missing.length === 0 && tokens.radius === "14px",
  JSON.stringify(tokens));

// 2. zen-pop-in 关键帧存在
const hasKf = await evalJs(
  cdp,
  `[...document.styleSheets].some(ss => { try { return [...ss.cssRules].some(r => r.type === CSSRule.KEYFRAMES_RULE && r.name === 'zen-pop-in'); } catch { return false; } })`,
);
check("zen-pop-in keyframes 存在", hasKf === true, String(hasKf));

// 3. 设置弹窗：Ribbon 设置按钮 → Modal 化（14px 圆角 + 单层阴影 + 标题栏）
const settingsOpen = await evalJs(
  cdp,
  `(async () => {
     document.querySelector('button[title="设置"]')?.click();
     await new Promise(r => setTimeout(r, 200));
     const bd = document.querySelector('[data-testid="settings-backdrop"]');
     if (!bd) return { __err: 'settings-backdrop 未渲染' };
     const panel = bd.firstElementChild;
     const cs = getComputedStyle(panel);
     return { radius: cs.borderRadius, shadow: cs.boxShadow, title: panel.querySelector('div')?.textContent?.trim(),
              overflow: cs.overflow };
   })()`,
);
check("设置弹窗 Modal 化（圆角 14 / 阴影 / 标题栏）",
  settingsOpen && settingsOpen.radius === "14px" && settingsOpen.shadow !== "none" && settingsOpen.title === "设置",
  JSON.stringify(settingsOpen));

// 4. 外观 tab：主题卡片 10 张，含墨岩/纸白；顺带记下当前主题以便收尾还原
const themeCards = await evalJs(
  cdp,
  `(async () => {
     const tabs = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')];
     tabs.find(b => b.textContent.trim() === '外观')?.click();
     await new Promise(r => setTimeout(r, 200));
     const cards = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'));
     return { n: cards.length,
              names: cards.map(c => c.textContent.replace('章节标题','').replace(/\\s+/g,' ').trim().slice(0,24)),
              // 「使用中」角标即当前主题（卡片此时显示的是「使用中」而非「深色/浅色」）
              current: cards.map(c => c.textContent.match(/([^\\s]+)使用中$/)?.[1]).find(Boolean) ?? null };
   })()`,
);
const originalTheme = themeCards?.current ?? "暗夜（默认）";
check("主题卡片 10 张且含墨岩/纸白",
  themeCards && themeCards.n === 10 &&
    themeCards.names.some((n) => n.includes("墨岩")) && themeCards.names.some((n) => n.includes("纸白")),
  JSON.stringify(themeCards));

// 5. 点墨岩 → style#bixian-theme 注入主色 #5b8def，--tab-selected-bg 随主题
const inkApplied = await evalJs(
  cdp,
  `(async () => {
     const cards = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'));
     cards.find(c => c.textContent.includes('墨岩'))?.click();
     await new Promise(r => setTimeout(r, 200));
     const s = getComputedStyle(document.documentElement);
     return { accent: s.getPropertyValue('--accent').trim(),
              tab: s.getPropertyValue('--tab-selected-bg').trim(),
              injected: !!document.getElementById('bixian-theme') };
   })()`,
);
check("墨岩主题生效（accent #5b8def + 注入 style）",
  inkApplied && inkApplied.accent === "#5b8def" && inkApplied.injected === true,
  JSON.stringify(inkApplied));

// 6. 关闭设置（Esc，验证 Modal 的 Esc 关闭）
const settingsClosed = await evalJs(
  cdp,
  `(async () => {
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
     await new Promise(r => setTimeout(r, 200));
     return !document.querySelector('[data-testid="settings-backdrop"]');
   })()`,
);
check("设置弹窗 Esc 关闭", settingsClosed === true, String(settingsClosed));

// 7. dock 选中 tab = 浮纸卡（背景 + 单层阴影 + 圆角）
const dockTab = await evalJs(
  cdp,
  `(() => {
     const bar = document.querySelector('div.h-9.shrink-0.border-b:not(.items-center)');
     if (!bar) return { __err: 'dock tab bar 未找到' };
     const card = bar.querySelector('button span[aria-hidden]');
     if (!card) return { __err: '选中浮卡未找到' };
     const cs = getComputedStyle(card);
     return { bg: cs.backgroundColor, shadow: cs.boxShadow, radius: cs.borderRadius };
   })()`,
);
check("dock 选中 tab 为浮纸卡",
  dockTab && dockTab.bg && dockTab.bg !== "rgba(0, 0, 0, 0)" &&
    dockTab.shadow !== "none" && dockTab.radius === "6px",
  JSON.stringify(dockTab));

// 8. 搜索面板：Ctrl+Shift+F → Modal 化（14px 圆角）+ Esc 关闭
const searchModal = await evalJs(
  cdp,
  `(async () => {
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F', ctrlKey: true, shiftKey: true, bubbles: true }));
     await new Promise(r => setTimeout(r, 250));
     const bd = document.querySelector('[data-testid="search-backdrop"]');
     if (!bd) return { __err: 'search-backdrop 未渲染' };
     const cs = getComputedStyle(bd.firstElementChild);
     const radius = cs.borderRadius, shadow = cs.boxShadow;
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
     await new Promise(r => setTimeout(r, 250));
     return { radius, shadow, closed: !document.querySelector('[data-testid="search-backdrop"]') };
   })()`,
);
check("搜索面板 Modal 化 + Esc 关闭",
  searchModal && searchModal.radius === "14px" && searchModal.shadow !== "none" && searchModal.closed === true,
  JSON.stringify(searchModal));

// 9. 一级视图切换仍正常（Modal 迁移与 dock 改版未波及视图渲染）
// 判据：Ribbon 激活态 = 按钮内含 aria-hidden 的左侧 accent 竖条。
// 起点为「写作」，故后续每次点击都是真切换而非折叠侧栏。
const viewSwitch = await evalJs(
  cdp,
  `(async () => {
     const out = {};
     for (const label of ['文风库', '素材库', '统计', '写作']) {
       const btn = document.querySelector('button[title="' + label + '"]');
       if (!btn) { out[label] = 'no-button'; continue; }
       btn.click();
       await new Promise(r => setTimeout(r, 250));
       const active = !!btn.querySelector('span[aria-hidden]');
       const alive = (document.querySelector('#root')?.children.length ?? 0) > 0;
       out[label] = active && alive ? 'ok' : 'active=' + active + ' alive=' + alive;
     }
     return out;
   })()`,
);
check("一级视图切换正常",
  viewSwitch && Object.values(viewSwitch).every((v) => v === "ok"),
  JSON.stringify(viewSwitch));

// 10. 还原验证前的主题，不覆盖用户偏好
const restored = await evalJs(
  cdp,
  `(async () => {
     document.querySelector('button[title="设置"]')?.click();
     await new Promise(r => setTimeout(r, 200));
     [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .find(b => b.textContent.trim() === '外观')?.click();
     await new Promise(r => setTimeout(r, 200));
     const card = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'))
       .find(c => c.textContent.includes(${JSON.stringify(originalTheme)}));
     if (!card) return { __err: '还原目标主题卡未找到: ' + ${JSON.stringify(originalTheme)} };
     card.click();
     await new Promise(r => setTimeout(r, 250));
     // 先读「使用中」再关弹窗（原顺序反了，Esc 后卡片已卸载永远读不到）
     const cur = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'))
       .map(c => c.textContent.match(/([^\\s]+)使用中$/)?.[1]).find(Boolean);
     window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
     await new Promise(r => setTimeout(r, 200));
     return { theme: cur ?? '(badge not found)', closed: !document.querySelector('[data-testid="settings-backdrop"]') };
   })()`,
);
check(`还原原主题（${originalTheme}）`, restored?.theme === originalTheme, JSON.stringify(restored));

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
cdp.close();
process.exit(failed.length ? 1 : 0);
