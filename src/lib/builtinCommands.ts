import { getViews } from "./nav/registry";
import { useUiNav } from "./nav/uiStore";
import { registerCommands, type Command } from "./commands";
import { useWorkspace } from "../stores/workspace";
import { useOutline } from "../stores/outline";
import { useSearch } from "../stores/search";
import { useSettings } from "../stores/settings";
import { useBinder } from "../stores/binder";
import { usePalette } from "../stores/palette";
import { useGroupView, type LensMode } from "../stores/groupView";
import { askAiAboutSelection } from "./ai/actions";
import { getActiveEditor } from "./editorBridge";
import { useInlineAi } from "../stores/inlineAi";
import { useChatFind } from "../components/chat/ChatFind";
import { canMerge, isVolume, mergeChapters, newChapterAfter, newCollection, newVolume, splitCurrentChapter } from "./binderActions";

/** 新建一章、打开它并进入行内改名（Scrivener：新建即命名）；位置 = Binder 选中章（多选取最后一章）之后，否则当前章之后 */
export async function newChapterAfterCurrent(): Promise<void> {
  const ws = useWorkspace.getState();
  if (ws.currentBookId == null) return;
  const nav = useUiNav.getState();
  if (nav.activeView !== "write") nav.setView("write");
  if (nav.sidebarCollapsed) nav.toggleSidebar();
  const sel = useBinder.getState().selected;
  await newChapterAfter(sel.length > 0 ? sel[sel.length - 1] : ws.currentChapterId);
}

const hasBook = () => useWorkspace.getState().currentBookId != null;
const hasChapter = () => useWorkspace.getState().currentChapterId != null;

/** 组视图模式（Ctrl+1/2/3）：作用于活动窗格；已在该模式再按一次回单章 */
function groupCommand(mode: LensMode, label: string, key: string): Command {
  return {
    id: `view.group.${mode}`,
    title: `组视图：${label}（再按一次回单章）`,
    category: "视图",
    keys: [key],
    when: hasBook,
    run: () => {
      const nav = useUiNav.getState();
      const pane = useWorkspace.getState().activePane;
      if (nav.activeView !== "write") {
        nav.setView("write");
        useGroupView.getState().setMode(pane, mode);
        return;
      }
      useGroupView.getState().toggle(pane, mode);
    },
  };
}

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
      id: "ai.inlineEdit",
      title: "就地改写选区（无选区 = 当前段）",
      category: "AI",
      keys: ["Alt+K"],
      when: () => useUiNav.getState().activeView === "write" && getActiveEditor() != null,
      run: () => useInlineAi.getState().open("edit"),
    },
    {
      id: "ai.continueHere",
      title: "从光标处续写（浮条预览）",
      category: "AI",
      keys: ["Alt+Enter"],
      when: () => useUiNav.getState().activeView === "write" && getActiveEditor() != null,
      run: () => useInlineAi.getState().open("continue"),
    },
    { id: "ai.tint", title: "标出 AI 写入的文字", category: "AI", run: () => useUiNav.getState().toggleAiTint() },
    { id: "ai.ghost", title: "幽灵补全（停顿后灰字提示，Tab 接受）", category: "AI", run: () => useUiNav.getState().toggleGhost() },
    {
      id: "ai.find",
      title: "在 AI 对话中查找",
      category: "AI",
      keys: ["Mod+F"],
      when: () => !!document.activeElement?.closest("[data-ai-dock]"),
      run: () => useChatFind.getState().setOpen(true),
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
    groupCommand("scrivenings", "串烧", "Mod+1"),
    groupCommand("corkboard", "卡片墙", "Mod+2"),
    groupCommand("outliner", "大纲列", "Mod+3"),
    {
      id: "binder.reveal",
      title: "在目录中定位当前章",
      category: "导航",
      keys: ["Mod+Shift+E"],
      when: hasBook,
      run: () => {
        const nav = useUiNav.getState();
        if (nav.activeView !== "write") nav.setView("write");
        if (nav.sidebarCollapsed) nav.toggleSidebar();
        useBinder.getState().reveal();
      },
    },
    { id: "collection.new", title: "新建集合…", category: "章节", when: hasBook, run: () => newCollection([], true) },
    // 阶段 3B：卷层级与拆分合并
    {
      id: "volume.new",
      title: "新建卷",
      category: "章节",
      keys: ["Alt+Shift+N"],
      when: hasBook,
      run: async () => {
        const nav = useUiNav.getState();
        if (nav.activeView !== "write") nav.setView("write");
        if (nav.sidebarCollapsed) nav.toggleSidebar();
        const sel = useBinder.getState().selected;
        await newVolume(sel[sel.length - 1] ?? useWorkspace.getState().currentChapterId);
      },
    },
    {
      id: "binder.hoist",
      title: "聚焦当前卷 / 回到全书（Hoist）",
      category: "导航",
      when: () => useWorkspace.getState().volumes.length > 0,
      run: () => {
        const b = useBinder.getState();
        if (b.hoist != null) {
          b.setHoist(null);
          return;
        }
        const ws = useWorkspace.getState();
        const sel = b.selected[b.selected.length - 1] ?? ws.currentChapterId;
        const vol = isVolume(sel) ? sel : ws.chapters.find((c) => c.id === sel)?.parent_id ?? null;
        if (vol != null) b.setHoist(vol);
      },
    },
    {
      id: "chapter.split",
      title: "在光标处拆分本章…",
      category: "章节",
      keys: ["Mod+Shift+K"],
      when: () => hasChapter() && useUiNav.getState().activeView === "write",
      run: () => splitCurrentChapter(),
    },
    {
      id: "chapter.merge",
      title: "合并所选章节（同卷相邻）",
      category: "章节",
      when: () => canMerge(useBinder.getState().selected),
      run: () => mergeChapters(useBinder.getState().selected),
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
