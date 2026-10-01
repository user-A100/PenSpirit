import { getViews } from "./nav/registry";
import { useUiNav } from "./nav/uiStore";
import { registerCommands, type Command } from "./commands";
import { useWorkspace } from "../stores/workspace";
import { useOutline } from "../stores/outline";
import { useSearch } from "../stores/search";
import { useSettings } from "../stores/settings";
import { useBinder } from "../stores/binder";
import { usePalette } from "../stores/palette";
import { askAiAboutSelection } from "./ai/actions";

/** 在当前章之后新建一章、打开它并进入行内改名（Scrivener：新建即命名） */
export async function newChapterAfterCurrent(): Promise<void> {
  const ws = useWorkspace.getState();
  if (ws.currentBookId == null) return;
  const nav = useUiNav.getState();
  if (nav.activeView !== "write") nav.setView("write");
  if (nav.sidebarCollapsed) nav.toggleSidebar();
  const created = await ws.createChapter("新章节", { afterId: ws.currentChapterId, select: true });
  if (created) useBinder.getState().startRename({ kind: "chapter", id: created.id });
}

const hasBook = () => useWorkspace.getState().currentBookId != null;
const hasChapter = () => useWorkspace.getState().currentChapterId != null;

export function builtinCommands(): Command[] {
  const cmds: Command[] = [
    {
      id: "palette.open",
      title: "命令面板",
      category: "导航",
      keys: ["Mod+K", "Mod+P"],
      allowInModal: true,
      run: () => {
        const p = usePalette.getState();
        if (p.open) p.close();
        else p.openPalette();
      },
    },
    {
      id: "palette.commands",
      title: "命令面板（只搜命令）",
      category: "导航",
      keys: ["Mod+Shift+P"],
      run: () => usePalette.getState().openPalette(">"),
    },
    { id: "view.toggleSidebar", title: "折叠/展开侧栏", category: "视图", keys: ["Mod+B"], run: () => useUiNav.getState().toggleSidebar() },
    { id: "view.toggleDock", title: "折叠/展开右侧面板", category: "视图", keys: ["Mod+\\"], run: () => useUiNav.getState().toggleDock() },
    { id: "editor.toggleOutline", title: "悬浮大纲", category: "编辑", keys: ["Alt+O"], run: () => useOutline.getState().toggle() },
    { id: "search.open", title: "全书搜索", category: "导航", keys: ["Mod+Shift+F"], run: () => useSearch.getState().openPanel() },
    { id: "nav.back", title: "后退（章节历史）", category: "导航", keys: ["Alt+ArrowLeft"], run: () => useWorkspace.getState().goBack() },
    { id: "nav.forward", title: "前进（章节历史）", category: "导航", keys: ["Alt+ArrowRight"], run: () => useWorkspace.getState().goForward() },
    { id: "editor.cycleSplit", title: "分屏：无 / 左右 / 上下", category: "编辑", keys: ["Alt+S"], run: () => useWorkspace.getState().cycleSplit() },
    {
      id: "view.focusMode",
      title: "专注模式（只留稿纸）",
      category: "视图",
      keys: ["F11", "Mod+Shift+Enter"],
      run: () => useUiNav.getState().toggleFocusMode(),
    },
    { id: "editor.typewriter", title: "打字机滚动", category: "编辑", run: () => useUiNav.getState().toggleTypewriter() },
    {
      id: "ai.toggle",
      title: "显示/收起 AI 对话",
      category: "AI",
      keys: ["Mod+J"],
      when: () => useUiNav.getState().activeView === "write",
      run: () => {
        const nav = useUiNav.getState();
        nav.setAiCollapsed(!nav.aiCollapsed);
      },
    },
    {
      id: "ai.quote",
      title: "把选区引用到 AI 对话",
      category: "AI",
      keys: ["Mod+L"],
      when: () => useUiNav.getState().activeView === "write",
      run: () => askAiAboutSelection(),
    },
    { id: "chapter.new", title: "新建章节", category: "章节", keys: ["Mod+N"], when: hasBook, run: newChapterAfterCurrent },
    {
      id: "chapter.rename",
      title: "重命名当前章",
      category: "章节",
      when: hasChapter,
      run: () => {
        const id = useWorkspace.getState().currentChapterId;
        if (id == null) return;
        if (useUiNav.getState().sidebarCollapsed) useUiNav.getState().toggleSidebar();
        useBinder.getState().startRename({ kind: "chapter", id });
      },
    },
    {
      id: "chapter.delete",
      title: "将当前章移到回收站",
      category: "章节",
      when: hasChapter,
      run: async () => {
        const id = useWorkspace.getState().currentChapterId;
        if (id != null) await useWorkspace.getState().deleteChapter(id);
      },
    },
    { id: "settings.open", title: "打开设置", category: "应用", keys: ["Mod+,"], allowInModal: false, run: () => useSettings.getState().open() },
  ];
  for (const v of getViews()) {
    cmds.push({ id: `view.go.${v.id}`, title: `切换到「${v.label}」`, category: "视图", run: () => useUiNav.getState().setView(v.id) });
  }
  return cmds;
}

export function registerBuiltinCommands(): () => void {
  return registerCommands(builtinCommands());
}
