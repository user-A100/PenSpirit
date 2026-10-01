// 实机核验公共库（阶段 0 起）：经 CDP 驱动运行中的笔仙 WebView2。
//
// 前置：先启动应用并打开调试端口——
//   node node_modules/vite/bin/vite.js --port 1420 --strictPort     （或 pnpm dev）
//   WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 src-tauri/target/debug/bixian.exe
//
// 状态保护（硬性要求）：withGuard() 在开始时快照 localStorage 全量，结束（含异常）时逐键还原
// 并断言无差异；脚本自建的隔离测试书在结束时彻底删除（移入回收站 → purge）。
// 阶段 2B 起：快照先落盘（.tmp-verify/guard-pending.json）——进程中途崩溃 / 被杀时清场没跑到，
// 下一次核验开始（或 `node scripts/verify/app.mjs recover`）会按它补做还原。
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.CDP_PORT ?? 9222);
const EXE = fileURLToPath(new URL("../../src-tauri/target/debug/bixian.exe", import.meta.url));
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const PENDING = fileURLToPath(new URL("../../.tmp-verify/guard-pending.json", import.meta.url));

async function findPage() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return list.find((t) => t.type === "page" && !t.url.includes("refwindow")) ?? null;
}

function appRunning() {
  try {
    return execSync('tasklist /FI "IMAGENAME eq bixian.exe" /NH', { encoding: "utf8" }).includes("bixian.exe");
  } catch {
    return false;
  }
}

/** 关闭应用：先发正常关闭（WM_CLOSE，等同点窗口关闭），10 秒不退再强杀 */
export async function stopApp() {
  if (!appRunning()) return;
  try {
    execSync("taskkill /IM bixian.exe", { stdio: "ignore" });
  } catch {
    // 窗口可能已在关闭中
  }
  for (let i = 0; i < 50 && appRunning(); i++) await sleep(200);
  if (appRunning()) execSync("taskkill /IM bixian.exe /F", { stdio: "ignore" });
  for (let i = 0; i < 25 && appRunning(); i++) await sleep(200);
}

/** 启动调试版应用（带 CDP 端口），等主窗口页面出现。前端须由 vite dev server 提供（1420）。 */
export async function startApp(timeout = 60000) {
  if (!existsSync(EXE)) throw new Error(`找不到 ${EXE}（先 cargo build）`);
  const child = spawn(EXE, [], {
    cwd: REPO,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  });
  child.unref();
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await findPage()) return;
    } catch {
      // 端口尚未就绪
    }
    await sleep(300);
  }
  throw new Error("应用启动超时（CDP 端口未就绪）");
}

export async function connect() {
  let ws;
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) => {
    const mid = ++id;
    ws.send(JSON.stringify({ id: mid, method, params }));
    return new Promise((r) => pending.set(mid, r));
  };
  const open = async () => {
    const page = await findPage();
    if (!page) throw new Error("找不到笔仙主窗口（应用是否已带 --remote-debugging-port 启动？）");
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = j;
    });
    await send("Runtime.enable");
    await send("Page.enable");
  };
  await open();

  /** 在页面里求值（支持 await）；页面异常抛成 Node 异常 */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? ex.text ?? "页面求值失败");
    return r.result?.result?.value;
  };
  /** 调后端命令（与前端同一通道） */
  const invoke = (cmd, args = {}) =>
    evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(cmd)}, ${JSON.stringify(args)})`);
  const screenshot = async (file) => {
    const shot = await send("Page.captureScreenshot", { format: "png" });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(shot.result.data, "base64"));
    return file;
  };
  const reload = async () => {
    await send("Page.reload", { ignoreCache: false });
    await sleep(300);
    await waitFor(evaluate, "document.readyState === 'complete' && !!document.querySelector('main')", 15000);
    await sleep(500);
  };
  /** 真实键盘事件（走 Chromium 输入管线，命中捕获阶段分发器与编辑器） */
  const press = async (key, { ctrl = false, shift = false, alt = false, code } = {}) => {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const keyCode = KEYCODES[key] ?? (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    const c = code ?? (key.length === 1 && /[a-z]/i.test(key) ? `Key${key.toUpperCase()}` : key);
    const base = { modifiers, key, code: c, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
    await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  };
  /** 输入文字（等同 IME 上屏后的 insertText） */
  const typeText = (text) => send("Input.insertText", { text });
  const click = async (x, y, button = "left") => {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
  };
  /** 点击某元素中心（selectorExpr 是返回元素的页面表达式） */
  const clickEl = async (selectorExpr, button = "left") => {
    const r = await evaluate(`(() => { const el = ${selectorExpr}; if (!el) return null; el.scrollIntoView({block:'center'}); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) throw new Error(`找不到元素：${selectorExpr}`);
    await click(r.x, r.y, button);
    return r;
  };
  /** 关闭并重启应用（「关闭重启后状态仍在」类核验），重连 CDP 并等主界面就绪 */
  const restart = async () => {
    try {
      ws.close();
    } catch {
      // 忽略
    }
    await stopApp();
    await startApp();
    await open();
    await waitFor(evaluate, "document.readyState === 'complete' && !!document.querySelector('main')", 30000);
    await sleep(800);
  };
  return { send, evaluate, invoke, screenshot, reload, press, typeText, click, clickEl, restart, close: () => ws.close() };
}

const KEYCODES = {
  Enter: 13, Escape: 27, Delete: 46, Backspace: 8, Tab: 9, F2: 113, F11: 122,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35,
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询页面表达式直到为真 */
export async function waitFor(evaluate, expr, timeout = 5000, interval = 100) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    try {
      last = await evaluate(expr);
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await sleep(interval);
  }
  throw new Error(`等待超时：${expr}（最后结果：${last}）`);
}

/** 断言收集器：失败不立即退出，跑完汇总 */
/**
 * 按快照还原核验前的用户状态：删本次建的测试书、本次新增的素材（素材库是全局的）、
 * 本次新增的服务商并还原「使用中」，localStorage 逐键还原。
 */
async function restoreFrom(app, p) {
  for (const id of p.books) {
    await app.invoke("delete_book", { id }).catch(() => {}); // 已在回收站时会失败，照常 purge
    try {
      await app.invoke("purge_book", { id });
    } catch (e) {
      console.error(`清理测试书 #${id} 失败：`, e?.message ?? e);
    }
  }
  for (const m of await app.invoke("materials_list", { query: null }).catch(() => [])) {
    if (m.id > p.materialsMaxId) await app.invoke("material_delete", { id: m.id }).catch(() => {});
  }
  for (const pr of await app.invoke("list_providers").catch(() => [])) {
    if (!p.providers.ids.includes(pr.id)) await app.invoke("delete_provider", { id: pr.id }).catch(() => {});
  }
  if (p.providers.active != null) await app.invoke("set_active_provider", { id: p.providers.active }).catch(() => {});
  // agent 登记（agents.json，阶段 2B 起）：删掉核验加的，还原默认 agent
  if (p.agents) {
    for (const a of await app.invoke("agents_list").catch(() => [])) {
      if (!p.agents.ids.includes(a.id)) await app.invoke("agents_remove", { id: a.id }).catch(() => {});
    }
    if (p.agents.defaultId) await app.invoke("agents_set_default", { id: p.agents.defaultId }).catch(() => {});
  }
  await app.evaluate(
    `(() => { const snap = ${JSON.stringify(p.localStorage)}; localStorage.clear(); for (const [k, v] of Object.entries(snap)) localStorage.setItem(k, v); return true; })()`,
  );
}

/** 上一次核验中途崩溃、没走到清场：按落盘快照补做还原。返回是否做了还原 */
export async function recoverPending(app) {
  if (!existsSync(PENDING)) return false;
  const p = JSON.parse(readFileSync(PENDING, "utf8"));
  console.log(`⚠ 发现未清场的核验「${p.name}」（${p.at}），先按当时的快照还原…`);
  await restoreFrom(app, p);
  unlinkSync(PENDING);
  await app.reload();
  return true;
}

export function checker() {
  const results = [];
  const check = (name, ok, detail = "") => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? "✔" : "✘"} ${name}${detail ? ` — ${detail}` : ""}`);
  };
  const summary = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    return failed.length === 0;
  };
  return { check, summary, results };
}

/**
 * 状态保护外壳：快照 localStorage → 跑 body → 还原 localStorage、删隔离书、刷新页面 →
 * 断言 localStorage 与快照逐键一致。body 收到 { app, makeBook }。
 */
export async function withGuard(name, body) {
  const app = await connect();
  await recoverPending(app);
  const before = await app.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))");
  // 后端设置里与核验相关的用户状态：服务商列表与「使用中」（阶段 3A 起纳入还原断言）
  const providerState = async () => JSON.stringify({ active: await app.invoke("get_active_provider"), ids: (await app.invoke("list_providers")).map((p) => p.id) });
  const providersBefore = await providerState();
  const materialsMaxId = Math.max(0, ...(await app.invoke("materials_list", { query: null })).map((m) => m.id));
  const agentState = async () => {
    const list = await app.invoke("agents_list");
    return { ids: list.map((a) => a.id), defaultId: list.find((a) => a.is_default)?.id ?? null, json: JSON.stringify(list) };
  };
  const agentsBefore = await agentState();
  // 快照先落盘：进程崩溃 / 被杀也能在下次补做还原
  const pending = {
    name,
    at: new Date().toISOString(),
    localStorage: JSON.parse(before),
    providers: JSON.parse(providersBefore),
    materialsMaxId,
    agents: { ids: agentsBefore.ids, defaultId: agentsBefore.defaultId },
    books: [],
  };
  const savePending = () => {
    mkdirSync(dirname(PENDING), { recursive: true });
    writeFileSync(PENDING, JSON.stringify(pending));
  };
  savePending();
  // 异步回调里的异常（如本地假服务出错）不让进程直接退出——主流程会超时失败并照常清场
  const onUncaught = (e) => console.error("✘ 未捕获异常：", e?.message ?? e);
  process.on("uncaughtException", onUncaught);
  // 原生对话框探针：任何 alert/confirm 调用都记下来（阶段 0 起禁止原生对话框）
  await app.evaluate(`(() => { window.__nativeDialogs = []; for (const k of ['alert','confirm','prompt']) { const o = window[k]; window[k] = (...a) => { window.__nativeDialogs.push(k + ':' + a[0]); return k === 'confirm' ? false : undefined; }; window['__orig_' + k] = o; } return true; })()`);
  const books = [];
  const makeBook = async (title, chapters = []) => {
    const book = await app.invoke("create_book", { title: `${title}·核验${Date.now() % 100000}` });
    books.push(book.id);
    pending.books = books;
    savePending();
    const ids = [];
    for (const [t, body] of chapters) {
      const c = await app.invoke("create_chapter", { bookId: book.id, title: t });
      if (body) await app.invoke("write_chapter", { id: c.id, content: body });
      ids.push(c.id);
    }
    return { book, ids };
  };
  let ok = false;
  let error = null;
  try {
    ok = await body({ app, makeBook });
  } catch (e) {
    error = e;
    console.error(`✘ ${name} 中断：`, e?.message ?? e);
    try {
      await app.screenshot(`.tmp-verify/${name}-error.png`);
    } catch {
      // 截图失败不影响清场
    }
  } finally {
    await restoreFrom(app, pending);
    await app.reload();
    const after = await app.evaluate("JSON.stringify(Object.fromEntries(Object.entries(localStorage)))");
    const a = JSON.parse(before);
    const b = JSON.parse(after);
    const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
    console.log(diff.length === 0 ? "✔ 状态还原：localStorage 与运行前逐键一致" : `✘ 状态还原失败，差异键：${diff.join(", ")}`);
    const left = await app.invoke("list_books");
    const leaked = left.filter((bk) => books.includes(bk.id));
    if (leaked.length) console.log(`✘ 测试书未清理：${leaked.map((bk) => bk.title).join(", ")}`);
    const providersAfter = await providerState();
    const providersOk = providersAfter === providersBefore;
    console.log(providersOk ? "✔ 状态还原：服务商列表与「使用中」与运行前一致" : `✘ 服务商状态未还原：${providersBefore} → ${providersAfter}`);
    const matsLeft = (await app.invoke("materials_list", { query: null })).filter((m) => m.id > materialsMaxId);
    if (matsLeft.length) console.log(`✘ 核验新增的素材未清理：${matsLeft.map((m) => m.title).join(", ")}`);
    const agentsOk = (await agentState()).json === agentsBefore.json;
    console.log(agentsOk ? "✔ 状态还原：agent 登记与默认 agent 与运行前一致" : "✘ agent 登记未还原");
    app.close();
    process.off("uncaughtException", onUncaught);
    if (diff.length || leaked.length || !providersOk || matsLeft.length || !agentsOk) ok = false;
    else unlinkSync(PENDING);
  }
  if (error) ok = false;
  console.log(ok ? `\n【${name}】通过` : `\n【${name}】未通过`);
  process.exitCode = ok ? 0 : 1;
  return ok;
}
