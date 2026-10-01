import { useEffect, useState } from "react";
import { api, type StyleCard } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { useChat } from "../../stores/chat";
import { openMenuAt } from "../../stores/menu";
import { toast } from "../../stores/toast";
import { errMsg } from "../../lib/errors";

// 文风预设快速切换（阶段 2B）：输入区底栏直接换本书的激活文风卡（文风库里管理），「不用文风」= 清空。
export function StyleSwitch({ className }: { className: string }) {
  const bookId = useWorkspace((s) => s.currentBookId);
  const [styles, setStyles] = useState<StyleCard[]>([]);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (bookId == null) return;
    let cancelled = false;
    void Promise.all([api.listStyles(), api.getActiveStyle(bookId)])
      .then(([list, id]) => {
        if (cancelled) return;
        setStyles(list);
        setActive(id && list.some((s) => s.id === id) ? id : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookId]);
  if (bookId == null || styles.length === 0) return null;
  const pick = async (id: number | null) => {
    try {
      await api.setActiveStyle(bookId, id ?? 0);
      setActive(id);
      useChat.getState().requestPreviewRefresh();
    } catch (e) {
      toast.error(errMsg(e));
    }
  };
  const name = styles.find((s) => s.id === active)?.name;
  return (
    <button
      data-tip="文风：本书当前激活的文风卡（文风库里管理）"
      onClick={(e) =>
        openMenuAt(e.currentTarget, [
          ...styles.map((s) => ({ label: s.name, checked: s.id === active, onSelect: () => void pick(s.id) })),
          { type: "separator" as const },
          { label: "不用文风", checked: active == null, onSelect: () => void pick(null) },
        ])
      }
      className={`${className} max-w-28 truncate ${name ? "text-[color:var(--accent)]" : ""}`}
    >
      {name ? `文风：${name}` : "文风"}
    </button>
  );
}
