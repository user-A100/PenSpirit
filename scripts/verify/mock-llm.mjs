// 本地 OpenAI 兼容假服务（阶段 2A 实机核验用，不需要真 API Key）。
// POST /v1/chat/completions（stream=true）按最后一条 user 消息里的暗号决定行为：
//   【429】→ 返回 429 限流；【断流】→ 吐几段后掐断连接；【慢】→ 每段 120ms（测停止）；
//   其余 → 正常流式。回答里带 [历史N条]（system 与本轮 user 之外的消息数）方便断言多轮。
// 每次请求体都记下来：requests / lastRequest() 供脚本断言「到底发了什么」。
// 独立运行：node scripts/verify/mock-llm.mjs [port]
import http from "node:http";

export function startMockLlm(port = 0) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      // 假服务自身出错只回 500，不能让核验进程崩掉（崩了清场就跑不到）
      handle().catch((e) => {
        console.error("mock-llm 出错：", e);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    const handle = async () => {
      let json = {};
      try {
        json = JSON.parse(body);
      } catch {
        // 忽略
      }
      requests.push(json);
      const msgs = json.messages ?? [];
      const last = [...msgs].reverse().find((m) => m.role === "user")?.content ?? "";
      const historyN = Math.max(0, msgs.length - 2);
      if (last.includes("【429】")) {
        res.writeHead(429, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit reached for mock", type: "rate_limit_error" } }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const chunk = (text, first = false) =>
        `data: ${JSON.stringify({
          id: "mock",
          object: "chat.completion.chunk",
          created: 0,
          model: json.model ?? "mock",
          choices: [
            {
              index: 0,
              delta: first ? { role: "assistant", content: text } : { content: text },
              finish_reason: null,
              // 阶段 2C：请求带 logprobs 时，第一个分片带上「此处最可能的字」
              ...(first && json.logprobs
                ? {
                    logprobs: {
                      content: [
                        {
                          token: "寒",
                          logprob: -0.4,
                          bytes: null,
                          top_logprobs: [
                            { token: "寒", logprob: -0.4, bytes: null },
                            { token: "冷", logprob: -1.5, bytes: null },
                            { token: "凉", logprob: -2.3, bytes: null },
                          ],
                        },
                      ],
                      refusal: null,
                    },
                  }
                : {}),
            },
          ],
        })}\n\n`;
      const sys = msgs[0]?.content ?? "";
      // 阶段 2B 抽取：系统提示要求「只输出 JSON 数组」→ 按类型回一份固定的 JSON
      if (sys.includes("只输出 JSON 数组")) {
        const data = sys.includes("词语顾问")
          ? ["刺骨", "凛冽", "寒彻"]
          : sys.includes("人物")
          ? [{ name: "沈砚", role: "主角", aliases: "砚哥", description: "冷面剑客，守着渡口" }, { name: "林晚", role: "女主", aliases: "", description: "递来半张地图的姑娘" }]
          : sys.includes("伏笔")
            ? [{ title: "半张地图", note: "另一半在反派手里，终局揭晓" }]
            : [{ content: "雪夜渡口初遇" }, { content: "旧城灯会交换地图" }];
        const text = "```json\n" + JSON.stringify(data) + "\n```";
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }] })}\n\n`);
        res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
        res.end("data: [DONE]\n\n");
        return;
      }
      const discuss = sys.includes("写作顾问");
      // 阶段 2B：选区里带「逐段核验」→ 逐段改写（含「原稿」的段改成「改稿」，其余原样），用来测逐段取舍 / 就地改写
      const sel = last.match(/【选中段落】\n([\s\S]*?)(?:\n\n|$)/)?.[1] ?? "";
      const pieces = sel.includes("逐段核验")
        ? [sel.replace(/原稿/g, "改稿")]
        : last.includes("【AI腔】")
          ? ["他嘴角勾起一抹弧度，", "转身走进雨里。"]
          : last.includes("明显不同的走向")
          ? ["1. 雪夜追兵逼近渡口\n", "2. 林晚负伤躲进旧城\n", "3. 旧城灯会突然失火"]
          : last.includes("压缩成一份要点摘要")
            ? ["摘要：沈砚守渡口；", "林晚递来半张地图。"]
            : discuss
              ? ["**建议**：", "节奏可以再快一些。\n", "- 删去重复的环境描写\n", `- 让冲突提前出现 [历史${historyN}条]`]
              : ["好的，以下是续写内容：\n", "夜雨初歇，渡口的灯笼次第亮起。", "\n沈砚把斗篷裹紧了些，", `回头望了一眼旧城。[历史${historyN}条]`];
      const slow = last.includes("【慢】");
      const cut = last.includes("【断流】");
      const out = slow ? [...pieces, ...pieces, ...pieces, ...pieces] : pieces;
      for (let i = 0; i < out.length; i++) {
        if (res.destroyed) return;
        res.write(chunk(out[i], i === 0));
        await new Promise((r) => setTimeout(r, slow ? 120 : 15));
        if (cut && i === 1) {
          res.socket?.destroy();
          return;
        }
      }
      res.write(`data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: "mock", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end("data: [DONE]\n\n");
    };
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const p = server.address().port;
      resolve({
        url: `http://127.0.0.1:${p}/v1`,
        requests,
        lastRequest: () => requests[requests.length - 1],
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}` || process.argv[1]?.endsWith("mock-llm.mjs")) {
  const m = await startMockLlm(Number(process.argv[2] ?? 8799));
  console.log(`mock LLM 已启动：${m.url}`);
}
