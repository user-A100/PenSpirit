// 本地假 ACP agent（阶段 2B 实机核验用，不需要装真 agent）：stdio 上说 JSON-RPC 2.0（一行一条）。
// 按提示里的暗号演一回合（cwd = 书目录，由 session/new 传入）：
//   【改文件】→ 读取工具调用 → 请求「编辑」权限 → 允许则给第一章补一段、新建一章文件、写一份设定笔记
//   【再改】  → 再请求一次「编辑」权限（测「本会话一直允许」），允许则给第一章再补一句
//   其余      → 只回一段文字
// 用法：在 agents.json 里登记 { command: <node>, args: [本文件绝对路径] }
import { createInterface } from "node:readline";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

let cwd = process.cwd();
let nextId = 1000;
const pending = new Map();
const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
const notify = (sessionId, update) => send({ method: "session/update", params: { sessionId, update } });
const request = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    send({ id, method, params });
  });

function firstChapter() {
  const dir = join(cwd, "manuscript");
  // 认名字里带「第一章」的那个（文件序号会因还原 / 重排而变，不能取排在最前的）
  const files = readdirSync(dir).filter((n) => n.endsWith(".md")).sort();
  const name = files.find((n) => n.includes("第一章")) ?? files[0];
  return join(dir, name);
}

async function prompt(id, params) {
  const sid = params.sessionId;
  const text = (params.prompt ?? []).map((b) => b.text ?? "").join("");
  const say = (t) => notify(sid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: t } });
  if (text.includes("【改文件】") || text.includes("【再改】")) {
    const again = text.includes("【再改】");
    const file = firstChapter();
    say(again ? "再补一句。" : "好的，我先看看第一章。");
    if (!again) notify(sid, { sessionUpdate: "tool_call", toolCallId: "read-1", title: "读取 第一章", kind: "read", status: "completed", locations: [{ path: file }] });
    const tc = again ? `edit-${Date.now()}` : "edit-1";
    notify(sid, { sessionUpdate: "tool_call", toolCallId: tc, title: "改写 第一章", kind: "edit", status: "pending", locations: [{ path: file }] });
    const r = await request("session/request_permission", {
      sessionId: sid,
      toolCall: { toolCallId: tc, title: "改写 第一章", kind: "edit" },
      options: [
        { optionId: "allow", name: "允许", kind: "allow_once" },
        { optionId: "reject", name: "拒绝", kind: "reject_once" },
      ],
    });
    if (!(r?.outcome?.outcome === "selected" && r.outcome.optionId === "allow")) {
      notify(sid, { sessionUpdate: "tool_call_update", toolCallId: tc, status: "failed" });
      say("没有得到权限，未修改。");
      return send({ id, result: { stopReason: "end_turn" } });
    }
    const old = readFileSync(file, "utf8");
    const neu = old.trimEnd() + (again ? "\n\nAI 又补了一句。" : "\n\nAI 补写的一段。");
    writeFileSync(file, neu);
    if (!again) {
      writeFileSync(join(cwd, "manuscript", "0099-AI新章.md"), "AI 写的新章。");
      writeFileSync(join(cwd, "设定.md"), "世界观：雪夜渡口。");
    }
    notify(sid, { sessionUpdate: "tool_call_update", toolCallId: tc, status: "completed", content: [{ type: "diff", path: file, oldText: old, newText: neu }] });
    say(again ? "加好了。" : "改好了，还新建了一章和一份设定笔记。");
  } else {
    say("收到。");
  }
  send({ id, result: { stopReason: "end_turn" } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method === undefined && msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
    return;
  }
  switch (msg.method) {
    case "initialize":
      return send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } });
    case "session/new":
      cwd = msg.params?.cwd ?? cwd;
      return send({ id: msg.id, result: { sessionId: "mock-session" } });
    case "session/prompt":
      return void prompt(msg.id, msg.params);
    case "session/cancel":
      return;
    default:
      if (msg.id !== undefined) send({ id: msg.id, error: { code: -32601, message: `未实现：${msg.method}` } });
  }
});
