import { useEffect, useRef, useState } from "react";

/**
 * 防抖自动保存。阶段 4：按「编辑版本号」触发，不再每次渲染都取内容比较——
 * 取内容（整篇序列化成 Markdown）推迟到防抖到期时只做一次（10 万字长章按键延迟从 ~240ms 降下来的关键之一）。
 */
export function useAutosave(
  getVersion: () => number,
  getDirty: () => string | null,
  save: (content: string) => Promise<void>,
  delayMs = 800,
) {
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<string | null>(null);
  // 保持 getDirty 永远是最新引用，供定时器触发时读取最新内容
  const getDirtyRef = useRef(getDirty);
  getDirtyRef.current = getDirty;
  const saveRef = useRef(save);
  saveRef.current = save;

  // effect 无依赖数组，每次渲染都看一眼版本号（很便宜）；版本变了才重置防抖。
  // 到期时才取内容：期间多少次输入都只序列化一次、只保存最后一次输入。
  const scheduled = useRef<number | null>(null);
  useEffect(() => {
    const v = getVersion();
    if (v === scheduled.current) return;
    scheduled.current = v;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      timer.current = null;
      const latest = getDirtyRef.current();
      if (latest == null || latest === lastSaved.current) return;
      setStatus("saving");
      await saveRef.current(latest);
      lastSaved.current = latest;
      setStatus("saved");
    }, delayMs);
  });

  // 卸载冲刷：分屏切换/切章会卸载编辑器实例，防抖窗口内的改动不能丢
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const latest = getDirtyRef.current();
      if (latest == null || latest === lastSaved.current) return;
      void saveRef.current(latest).catch((e) => console.warn("autosave flush on unmount:", e));
    },
    [],
  );

  return { status };
}
