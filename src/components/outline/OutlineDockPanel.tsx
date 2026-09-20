import { parseHeadings } from "../../lib/headings";
import { useOutline } from "../../stores/outline";
import { useWorkspace } from "../../stores/workspace";

// 大纲 dock 面板（write 视图 dock 的 outline tab，M4 实装）。
// 与 Alt+O 悬浮大纲（FloatingOutline）同源同行为：上「本章」两级小标题点击
// 定位正文，下「全书」章节点击切换；区别是常驻 dock 而非浮窗。
// 本章标题取 workspace.chapterContent（read_chapter 的全量 md；编辑器内
// 未保存的即时改动不在此反映——与浮窗版的 props.markdown 略有差异）。

export function OutlineDockPanel() {
  const chapters = useWorkspace((s) => s.chapters);
  const currentChapterId = useWorkspace((s) => s.currentChapterId);
  const content = useWorkspace((s) => s.chapterContent);

  const headings = parseHeadings(content ?? "");

  return (
    <div className="h-full overflow-y-auto p-3 text-xs">
      <div className="outline-sep">本章</div>
      {headings.length === 0 ? (
        <div className="outline-empty">本章无小标题</div>
      ) : (
        <ul className="outline-list">
          {headings.map((h) => (
            <li
              key={`${h.level}:${h.text}`}
              className={h.level === 2 ? "lv2" : undefined}
              title={h.text}
              onClick={() => useOutline.getState().request(h.text)}
            >
              {h.text}
            </li>
          ))}
        </ul>
      )}

      <div className="outline-sep">全书</div>
      <ul className="outline-list">
        {chapters.map((c) => (
          <li
            key={c.id}
            className={c.id === currentChapterId ? "active" : undefined}
            title={c.title}
            onClick={() => {
              // 重复点击当前章不重读正文
              if (c.id !== useWorkspace.getState().currentChapterId)
                void useWorkspace.getState().selectChapter(c.id);
            }}
          >
            {c.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
