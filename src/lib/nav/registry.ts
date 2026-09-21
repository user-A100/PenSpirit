import type { ComponentType } from "react";
import { BarChart3, Blocks, BookOpen, CircleDot, Flag, LayoutGrid, Library, ListTree, Network, PenLine, Sparkles, Tag, Users, type LucideIcon } from "lucide-react";
import { BumpView } from "../../views/BumpView";
import { WriteView } from "../../views/WriteView";
import { ReadView } from "../../views/read/ReadView";
import { MaterialsView } from "../../views/MaterialsView";
import { StatsView } from "../../views/StatsView";
import { StylesView } from "../../views/StylesView";
import { GraphView } from "../../views/GraphView";
import { StructureView } from "../../views/StructureView";
import { useUiNav } from "./uiStore";

// 一级视图注册表（仿 Agentero 命令式注册）：Ribbon/App/PanelDock 均从此读取导航结构，
// 新增一级视图 = registerView 一次，无需改动导航组件。
export type DockPanelDef = {
  id: string; // 面板唯一 id（PanelDock 内容映射的键）
  label: string; // tab 文案
  icon: LucideIcon; // tab 图标
};

export type NavView = {
  id: string; // "write" | "bump"
  label: string; // Ribbon 提示与视图标题
  icon: LucideIcon; // Ribbon 图标
  Component: ComponentType; // 一级视图根组件
  dockPanels: DockPanelDef[]; // 该视图的二级面板（PanelDock 动态渲染 tab）
};

const views = new Map<string, NavView>();

/** 注册一级视图；按 id 幂等（重复注册时先注册者生效） */
export function registerView(v: NavView): void {
  if (!views.has(v.id)) views.set(v.id, v);
}

/** 全部已注册视图（按注册顺序） */
export function getViews(): readonly NavView[] {
  return [...views.values()];
}

/** 按 id 取视图；未注册返回 undefined */
export function getView(id: string): NavView | undefined {
  return views.get(id);
}

// ---- 内置视图 ----
registerView({
  id: "write",
  label: "写作",
  icon: PenLine,
  Component: WriteView,
  dockPanels: [
    { id: "meta", label: "元数据", icon: Tag },
    { id: "outline", label: "大纲", icon: ListTree },
    { id: "characters", label: "人物", icon: Users },
    { id: "foreshadow", label: "伏笔", icon: Flag },
    { id: "plot", label: "情节块", icon: Blocks },
  ],
});

registerView({
  id: "bump",
  label: "碰碰车",
  icon: CircleDot,
  Component: BumpView,
  dockPanels: [], // T10 填充
});

registerView({
  id: "read",
  label: "阅读",
  icon: BookOpen,
  Component: ReadView,
  dockPanels: [], // 全屏阅读无 dock 面板；四边热区面板在 T5 以覆盖层实现
});

// M4：原 write dock 的统计/文风 tab 升级为一级视图，素材库新增
registerView({
  id: "styles",
  label: "文风库",
  icon: Sparkles,
  Component: StylesView,
  dockPanels: [],
});

registerView({
  id: "stats",
  label: "统计",
  icon: BarChart3,
  Component: StatsView,
  dockPanels: [],
});

registerView({
  id: "materials",
  label: "素材库",
  icon: Library,
  Component: MaterialsView,
  dockPanels: [],
});

// M5 图谱：家族树 / 关系网络 / 世界地图（画布类视图，ViewShell wide 不限宽）
registerView({
  id: "graph",
  label: "图谱",
  icon: Network,
  Component: GraphView,
  dockPanels: [],
});

// M7 批次2 结构：卡片墙/大纲列/串烧 三视图 + 章节模板管理
registerView({
  id: "structure",
  label: "结构",
  icon: LayoutGrid,
  Component: StructureView,
  dockPanels: [],
});

// 启动自愈：持久化的视图 id 未注册（旧版本残留/手改 localStorage）时回退 write 并写回
const storedView = useUiNav.getState().activeView;
if (!getView(storedView)) {
  useUiNav.getState().setView("write");
}
