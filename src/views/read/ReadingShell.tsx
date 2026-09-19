import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ChevronsDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronsUp,
  Lock,
  LockOpen,
} from "lucide-react";
import type { ChapterMeta } from "../../lib/tauri";
import { useReadingPanels, type PanelPos } from "./readingPanels";
import { NavPanel } from "./NavPanel";
import { TopPanel } from "./TopPanel";
import { BottomPanel } from "./BottomPanel";
import { SettingPanel } from "./SettingPanel";

// 阅读四边面板调度壳（books-reader 40-414 行机制移植到 hooks）：
// - 热区 onMouseEnter → 500ms 延迟且鼠标静止（100ms 内无移动）才 open；
//   面板 onMouseLeave → 500ms 后 close；enter/leave 计时器互 clear
// - 锁定 = 常驻 + 正文容器 padding 让位；点击正文关闭全部未锁面板
// - 右面板内 input 聚焦（React 焦点冒泡）时禁止收回，防输入到一半缩回
// 正文作为 children 传入；三面板数据全部由 props 注入（保持组件无 store 依赖）。

const PANEL_ENTER_DELAY = 500;
const PANEL_LEAVE_DELAY = 500;
const MOUSE_STILL_MS = 100;
const ALL_POS: PanelPos[] = ["left", "right", "top", "bottom"];

const HOTZONE_ICON: Record<PanelPos, typeof ChevronsLeft> = {
  left: ChevronsLeft,
  right: ChevronsRight,
  top: ChevronsUp,
  bottom: ChevronsDown,
};

interface ReadingShellProps {
  bookTitle: string;
  chapterTitle: string;
  /** 本次进入阅读的时刻（ms 时间戳） */
  startedAt: number;
  /** 最新滚动比例 0-1（ReadView 滚动时同步写入，TopPanel 轮询消费） */
  progressRef: { current: number };
  chapters: ChapterMeta[];
  currentChapterId: number | null;
  onSelectChapter: (id: number) => void;
  onExit: () => void;
  onPrevChapter: () => void;
  onNextChapter: () => void;
  prevDisabled: boolean;
  nextDisabled: boolean;
  children: ReactNode;
}

export function ReadingShell(props: ReadingShellProps) {
  const {
    bookTitle, chapterTitle, startedAt, progressRef, chapters,
    currentChapterId, onSelectChapter, onExit,
    onPrevChapter, onNextChapter, prevDisabled, nextDisabled, children,
  } = props;

  const left = useReadingPanels((s) => s.left);
  const right = useReadingPanels((s) => s.right);
  const top = useReadingPanels((s) => s.top);
  const bottom = useReadingPanels((s) => s.bottom);
  const navLocked = useReadingPanels((s) => s.navLocked);
  const settingLocked = useReadingPanels((s) => s.settingLocked);
  const setNavLocked = useReadingPanels((s) => s.setNavLocked);
  const setSettingLocked = useReadingPanels((s) => s.setSettingLocked);

  const [hovering, setHovering] = useState<PanelPos | null>(null);
  const enterTimers = useRef<Record<PanelPos, number | null>>({ left: null, right: null, top: null, bottom: null });
  const leaveTimers = useRef<Record<PanelPos, number | null>>({ left: null, right: null, top: null, bottom: null });
  const edgeHovering = useRef<Record<PanelPos, boolean>>({ left: false, right: false, top: false, bottom: false });
  const mouseMoving = useRef(false);
  /** 右面板内 input 聚焦中（设置搜索等场景，T6 消费） */
  const settingInputFocus = useRef(false);

  // 鼠标静止判定：最近一次移动后 100ms 内视为“正在移动”（books 同款语义）
  useEffect(() => {
    let stillTimer: number | undefined;
    const onMove = () => {
      mouseMoving.current = true;
      window.clearTimeout(stillTimer);
      stillTimer = window.setTimeout(() => (mouseMoving.current = false), MOUSE_STILL_MS);
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.clearTimeout(stillTimer);
    };
  }, []);

  const cancelEnter = useCallback((p: PanelPos) => {
    edgeHovering.current[p] = false;
    const t = enterTimers.current[p];
    if (t != null) {
      window.clearTimeout(t);
      enterTimers.current[p] = null;
    }
  }, []);

  const cancelLeave = useCallback((p: PanelPos) => {
    const t = leaveTimers.current[p];
    if (t != null) {
      window.clearTimeout(t);
      leaveTimers.current[p] = null;
    }
  }, []);

  const scheduleEnter = useCallback(
    (p: PanelPos) => {
      cancelEnter(p);
      edgeHovering.current[p] = true;
      enterTimers.current[p] = window.setTimeout(() => {
        enterTimers.current[p] = null;
        if (!edgeHovering.current[p] || mouseMoving.current) return;
        edgeHovering.current[p] = false;
        useReadingPanels.getState().open(p);
      }, PANEL_ENTER_DELAY);
    },
    [cancelEnter],
  );

  const scheduleLeave = useCallback(
    (p: PanelPos) => {
      // 右面板内 input 聚焦时不收回（也不武装计时器，免得输入中途缩回）
      if (p === "right" && settingInputFocus.current) return;
      cancelLeave(p);
      leaveTimers.current[p] = window.setTimeout(() => {
        leaveTimers.current[p] = null;
        useReadingPanels.getState().close(p); // 锁定面板 store 内部不吃 close
      }, PANEL_LEAVE_DELAY);
    },
    [cancelLeave],
  );

  // 卸载清计时器
  useEffect(
    () => () => {
      ALL_POS.forEach((p) => {
        const e = enterTimers.current[p];
        if (e != null) window.clearTimeout(e);
        const l = leaveTimers.current[p];
        if (l != null) window.clearTimeout(l);
      });
    },
    [],
  );

  const onHotzoneEnter = (p: PanelPos) => {
    setHovering(p);
    if (useReadingPanels.getState()[p]) {
      cancelLeave(p); // 面板开着（如从面板滑出再回来）→ 取消收回
      return;
    }
    scheduleEnter(p);
  };
  const onHotzoneLeave = (p: PanelPos) => {
    cancelEnter(p);
    setHovering(null);
  };
  const onHotzoneClick = (p: PanelPos) => {
    cancelEnter(p);
    cancelLeave(p);
    useReadingPanels.getState().open(p);
  };

  // 点击正文：关闭全部未锁定面板（close 内部自守锁定）
  const onContentClick = () => {
    const s = useReadingPanels.getState();
    ALL_POS.forEach((p) => s[p] && s.close(p));
  };

  const lockButton = (locked: boolean, onClick: () => void, title: string, corner: string) => (
    <button
      onClick={onClick}
      title={title}
      className={`absolute z-10 flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-faint)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${corner}`}
    >
      {locked ? <Lock size={13} /> : <LockOpen size={13} />}
    </button>
  );

  return (
    <div className="reading-shell relative h-full w-full">
      {/* 正文（锁定让位；点击关闭未锁面板） */}
      <div
        className="h-full w-full"
        onClick={onContentClick}
        style={{
          paddingLeft: navLocked ? "var(--read-panel-w)" : undefined,
          paddingRight: settingLocked ? "var(--read-panel-w)" : undefined,
          transition: "padding 0.5s ease",
        }}
      >
        {children}
      </div>

      {/* 四边热区 */}
      {ALL_POS.map((p) => {
        const Icon = HOTZONE_ICON[p];
        return (
          <div
            key={p}
            className={`read-hotzone read-hotzone-${p}`}
            data-hover={hovering === p ? "true" : undefined}
            onMouseEnter={() => onHotzoneEnter(p)}
            onMouseLeave={() => onHotzoneLeave(p)}
            onClick={() => onHotzoneClick(p)}
          >
            <Icon size={16} />
          </div>
        );
      })}

      {/* 左：目录 */}
      <section
        className="read-panel read-panel-left"
        data-open={left ? "true" : undefined}
        onMouseEnter={() => cancelLeave("left")}
        onMouseLeave={() => scheduleLeave("left")}
      >
        {lockButton(
          navLocked,
          () => setNavLocked(!navLocked),
          navLocked ? "解锁目录面板" : "锁定目录面板（常驻）",
          "right-2 top-2",
        )}
        <div className="read-panel-content">
          <NavPanel
            active={left}
            bookTitle={bookTitle}
            chapters={chapters}
            currentChapterId={currentChapterId}
            onSelectChapter={onSelectChapter}
          />
        </div>
      </section>

      {/* 右：设置（T6 挂 SettingPanel；focus 冒泡守卫已就位） */}
      <section
        className="read-panel read-panel-right"
        data-open={right ? "true" : undefined}
        onMouseEnter={() => cancelLeave("right")}
        onMouseLeave={() => scheduleLeave("right")}
      >
        {lockButton(
          settingLocked,
          () => setSettingLocked(!settingLocked),
          settingLocked ? "解锁设置面板" : "锁定设置面板（常驻）",
          "left-2 top-2",
        )}
        <div
          className="read-panel-content"
          onFocus={() => (settingInputFocus.current = true)}
          onBlur={() => (settingInputFocus.current = false)}
        >
          <SettingPanel />
        </div>
      </section>

      {/* 上：书名/章名 + 时长 + 进度 + 全屏/退出 */}
      <section
        className="read-panel read-panel-top"
        data-open={top ? "true" : undefined}
        onMouseEnter={() => cancelLeave("top")}
        onMouseLeave={() => scheduleLeave("top")}
      >
        <div className="read-panel-content">
          <TopPanel
            bookTitle={bookTitle}
            chapterTitle={chapterTitle}
            startedAt={startedAt}
            progressRef={progressRef}
            onExit={onExit}
          />
        </div>
      </section>

      {/* 下：进度滑条 + 换章 */}
      <section
        className="read-panel read-panel-bottom"
        data-open={bottom ? "true" : undefined}
        onMouseEnter={() => cancelLeave("bottom")}
        onMouseLeave={() => scheduleLeave("bottom")}
      >
        <div className="read-panel-content">
          <BottomPanel
            chapters={chapters}
            currentChapterId={currentChapterId}
            onSelectChapter={onSelectChapter}
            onPrev={onPrevChapter}
            onNext={onNextChapter}
            prevDisabled={prevDisabled}
            nextDisabled={nextDisabled}
          />
        </div>
      </section>
    </div>
  );
}
