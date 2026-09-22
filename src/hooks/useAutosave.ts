import { useEffect, useRef, useState } from "react";

export function useAutosave(
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

  // effect 无依赖数组，每次渲染都检查——依赖 getDirty 返回内容比较，
  // 模板组件 onUpdate 后触发重渲染即可驱动。
  useEffect(() => {
    const content = getDirty();
    if (content == null || content === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      // 触发时重读最新内容：即使期间没有重渲染，也只保存最后一次输入
      const latest = getDirtyRef.current();
      if (latest == null || latest === lastSaved.current) return;
      setStatus("saving");
      await save(latest);
      lastSaved.current = latest;
      setStatus("saved");
    }, delayMs);
    return () => { if (timer.current) clearTimeout(timer.current); };
  });

  // 卸载冲刷：分屏切换/切章会卸载编辑器实例，防抖窗口内的改动不能丢
  useEffect(
    () => () => {
      const latest = getDirtyRef.current();
      if (latest == null || latest === lastSaved.current) return;
      void saveRef.current(latest).catch((e) => console.warn("autosave flush on unmount:", e));
    },
    [],
  );

  return { status };
}
