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
  const reorderAll = useWorkspace((s) => s.reorderChapters);
  return {
    chapters: props.chapters ?? all,
    reorder: props.reorder === undefined ? reorderAll : props.reorder,
    onOpen: props.onOpen ?? ((id: number) => void openChapter(id)),
    allowFreeform: props.allowFreeform ?? props.chapters === undefined,
  };
}
