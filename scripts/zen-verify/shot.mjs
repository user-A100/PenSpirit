// 截图：切到指定主题 → 存「设置面板」与「主界面」两张图，用于肉眼确认。
// 用法：node scripts/zen-verify/shot.mjs <主题名> <输出前缀>
const PORT = 9222;
const themeName = process.argv[2] ?? "墨岩";
const prefix = process.argv[3] ?? ".tmp-zen-ref/shot";

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
  return new Promise((r) => pending.set(mid, r));
};
await new Promise((r) => (ws.onopen = r));
await send("Runtime.enable");
await send("Page.enable");

const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return r.result?.result?.value;
};
const { writeFileSync, mkdirSync } = await import("node:fs");
mkdirSync(".tmp-zen-ref", { recursive: true });
const capture = async (file) => {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(file, Buffer.from(shot.result.data, "base64"));
  console.log(`已保存 ${file}`);
};

// 打开设置 → 外观 → 点目标主题卡
const ok = await evalJs(
  `(async () => {
     document.querySelector('button[title="设置"]')?.click();
     await new Promise(r => setTimeout(r, 250));
     [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .find(b => b.textContent.trim() === '外观')?.click();
     await new Promise(r => setTimeout(r, 250));
     const card = [...document.querySelectorAll('[data-testid="settings-backdrop"] button')]
       .filter(b => b.textContent.includes('章节标题'))
       .find(c => c.textContent.includes(${JSON.stringify(themeName)}));
     if (!card) return false;
     card.click();
     await new Promise(r => setTimeout(r, 500));
     return true;
   })()`,
);
if (!ok) {
  console.error(`未找到主题卡片：${themeName}`);
  process.exit(1);
}

await capture(`${prefix}-settings.png`);

// 关掉设置面板，再截主界面（dock 浮纸卡在右侧）
await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
await new Promise((r) => setTimeout(r, 400));
await capture(`${prefix}-app.png`);

ws.close();
