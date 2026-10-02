import { useMemo } from "react";
import type { ChapterMeta } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { openChapter } from "../../lib/binderActions";

// 三视图（卡片墙 / 大纲列 / 串烧）的公共「透镜」参数（阶段 3A）：同一份章节数据的不同呈现。
// 不传则默认看整本书、按目录序可重排、双击打开单章——结构一级视图与旧调用方式不变；
// 编辑区组视图传入多选 / 集合的章节与对应的重排函数（只读集合传 null）。
export interface LensProps {
  chapters?: ChapterMeta[];
  /** 重排写回；null = 只读（搜索集合 / 视图排序态） */
  reorder?: ((ids: number[]) => Promise<void> | void) | null;
  onOpen?: (id: number) => void;
  /** 自由摆位（坐标按章全局保存，只在整本书范围开放） */
  allowFreeform?: boolean;
}

export function useLens(props: LensProps) {
  const all = useWorkspace((s) => s.chapters);
  const hasVolumes = useWorkspace((s) => s.volumes.length > 0);
  const reorderAll = useWorkspace((s) => s.reorderChapters);
  return {
    chapters: props.chapters ?? all,
    reorder: props.reorder === undefined ? reorderAll : props.reorder,
    onOpen: props.onOpen ?? ((id: number) => void openChapter(id)),
    // 自由摆位的「落序」按章重排，有卷的书会打乱卷结构——只在无卷的整本书开放
    allowFreeform: props.allowFreeform ?? (props.chapters === undefined && !hasVolumes),
  };
}

/** 节点字数（阶段 3B）：章 = 本章；卷 = 卷首语 + 卷内各章 */
export function useNodeWords(): (n: ChapterMeta) => number {
  const chapters = useWorkspace((s) => s.chapters);
  const sums = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of chapters) if (c.parent_id != null) m.set(c.parent_id, (m.get(c.parent_id) ?? 0) + c.word_count);
    return m;
  }, [chapters]);
  return (n) => (n.kind === "folder" ? n.word_count + (sums.get(n.id) ?? 0) : n.word_count);
}

/** 卷内章数 */
export function useChildCount(): (id: number) => number {
  const chapters = useWorkspace((s) => s.chapters);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of chapters) if (c.parent_id != null) m.set(c.parent_id, (m.get(c.parent_id) ?? 0) + 1);
    return m;
  }, [chapters]);
  return (id) => counts.get(id) ?? 0;
}
