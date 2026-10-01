import { listen } from "@tauri-apps/api/event";
import { api, type TransientTask } from "../tauri";

type DeltaEvent = { type: string; text?: string };

// 一次性生成（阶段 2B）：抽取设定卡 / 内联改写 / 光标处续写浮条。不落进对话历史；
// 增量经 transient://{id} 推送，onDelta 实时显示；cancel 走 cancelGeneration(id)（已生成部分照常返回）。
let seq = 0;

export interface TransientRun {
  id: number;
  done: Promise<string>;
  cancel: () => void;
}

export function runTransient(task: TransientTask, onDelta?: (all: string) => void): TransientRun {
  const id = -(Date.now() % 1_000_000_000) * 10 - (++seq % 10);
  let acc = "";
  const done = (async () => {
    const un = await listen<DeltaEvent>(`transient://${id}`, (ev) => {
      if (ev.payload.type === "delta") {
        acc += ev.payload.text ?? "";
        onDelta?.(acc);
      }
    });
    try {
      return await api.aiTransient(id, task);
    } finally {
      un();
    }
  })();
  return { id, done, cancel: () => void api.cancelGeneration(id).catch(() => {}) };
}
