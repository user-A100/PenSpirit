import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta, Keyword, Label, Status } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";

vi.mock("../../lib/tauri", () => ({
  api: {
    labelsList: vi.fn(),
    labelUpsert: vi.fn(),
    labelDelete: vi.fn(),
    statusesList: vi.fn(),
    statusUpsert: vi.fn(),
    statusDelete: vi.fn(),
    keywordsList: vi.fn(),
    keywordCreate: vi.fn(),
    keywordDelete: vi.fn(),
    chapterUpdateMeta: vi.fn(),
    keywordsForChapter: vi.fn(),
    chapterSetKeywords: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { MetaDockPanel } from "./MetaDockPanel";

const LABELS: Label[] = [
  { id: 1, book_id: 1, title: "红", color: "#f87171", sort_key: 0, created_at: "" },
  { id: 2, book_id: 1, title: "蓝", color: "#60a5fa", sort_key: 1, created_at: "" },
];
const STATUSES: Status[] = [
  { id: 10, book_id: 1, title: "待写", sort_key: 0, created_at: "" },
  { id: 11, book_id: 1, title: "写作中", sort_key: 1, created_at: "" },
];
const KEYWORDS: Keyword[] = [
  { id: 20, book_id: 1, title: "修仙", color: "#60a5fa", created_at: "" },
  { id: 21, book_id: 1, title: "权谋", color: "#4ade80", created_at: "" },
];

function ch(p: Partial<ChapterMeta> & Pick<ChapterMeta, "id">): ChapterMeta {
  return {
    book_id: 1, file_path: "", title: "第一章", sort_key: 1, word_count: 1200,
    created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null,
    target_words: null, ...p,
  };
}

const CH1 = ch({ id: 11, synopsis: "少年入山", label_id: 1, status_id: 11, target_words: 3000 });
const CH2 = ch({ id: 12, sort_key: 2 });

function resetStores() {
  useWorkspace.setState({
    books: [], chapters: [CH1, CH2], currentBookId: 1, currentChapterId: 11, chapterContent: null,
  });
  useMeta.setState({ labels: LABELS, statuses: STATUSES, keywords: KEYWORDS, chapterKeywords: [KEYWORDS[0]] });
}

beforeEach(() => {
  vi.clearAllMocks();
  // 先备好 mock 再动 store：workspace.setState 会同步触发 meta 订阅拉取
  (api.labelsList as ReturnType<typeof vi.fn>).mockResolvedValue(LABELS);
  (api.statusesList as ReturnType<typeof vi.fn>).mockResolvedValue(STATUSES);
  (api.keywordsList as ReturnType<typeof vi.fn>).mockResolvedValue(KEYWORDS);
  (api.keywordsForChapter as ReturnType<typeof vi.fn>).mockResolvedValue([KEYWORDS[0]]);
  (api.chapterUpdateMeta as ReturnType<typeof vi.fn>).mockImplementation(
    (_id: number, update: Record<string, unknown>) =>
      Promise.resolve({ ...CH1, ...Object.fromEntries(Object.entries(update).filter(([, v]) => v !== undefined)) }),
  );
  (api.chapterSetKeywords as ReturnType<typeof vi.fn>).mockImplementation(
    (_cid: number, ids: number[]) => Promise.resolve(KEYWORDS.filter((k) => ids.includes(k.id))),
  );
  (api.keywordCreate as ReturnType<typeof vi.fn>).mockImplementation(
    (_bid: number, title: string) =>
      Promise.resolve({ id: 99, book_id: 1, title, color: "#facc15", created_at: "" }),
  );
  resetStores();
});

describe("MetaDockPanel（M7 章节元数据）", () => {
  it("渲染当前章元数据：标题、梗概、状态选中、标签高亮、关键词 chips、进度文案", () => {
    render(<MetaDockPanel />);
    expect(screen.getByText("第一章")).toBeInTheDocument();
    expect(screen.getByDisplayValue("少年入山")).toBeInTheDocument();

    const select = screen.getByRole("combobox", { name: "写作状态" }) as HTMLSelectElement;
    expect(select.value).toBe("11");

    // 标签「红」选中（outline 样式类），「蓝」未选
    const red = screen.getByTitle("红（点击取消）");
    expect(red.className).toContain("outline");
    expect(screen.getByTitle("蓝")).toBeInTheDocument();

    expect(screen.getByText("修仙")).toBeInTheDocument();
    expect(screen.getByText("已写 1200 字 · 40%")).toBeInTheDocument();
  });

  it("梗概失焦保存并原地更新 workspace.chapters", async () => {
    render(<MetaDockPanel />);
    const ta = screen.getByDisplayValue("少年入山");
    fireEvent.change(ta, { target: { value: "少年下山" } });
    fireEvent.blur(ta);

    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { synopsis: "少年下山" }));
    await waitFor(() => {
      expect(useWorkspace.getState().chapters.find((c) => c.id === 11)?.synopsis).toBe("少年下山");
    });
  });

  it("点标签挂上/再点取消；下拉切状态；目标字数失焦保存", async () => {
    render(<MetaDockPanel />);

    fireEvent.click(screen.getByTitle("蓝"));
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { label_id: 2 }));

    // 点蓝后 store 已更新：再点已选中的蓝块 = 取消（置 null）
    fireEvent.click(screen.getByTitle("蓝（点击取消）"));
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { label_id: null }));

    fireEvent.change(screen.getByRole("combobox", { name: "写作状态" }), { target: { value: "" } });
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { status_id: null }));

    const tw = screen.getByPlaceholderText("本章目标…");
    fireEvent.change(tw, { target: { value: "5000" } });
    fireEvent.blur(tw);
    await waitFor(() => expect(api.chapterUpdateMeta).toHaveBeenCalledWith(11, { target_words: 5000 }));
  });

  it("关键词：已挂词回车摘除；新词回车建档并挂上", async () => {
    render(<MetaDockPanel />);

    // 摘除已挂的「修仙」
    fireEvent.click(screen.getByTitle("摘除"));
    await waitFor(() => expect(api.chapterSetKeywords).toHaveBeenCalledWith(11, []));

    // 新词建档 + 挂上
    const input = screen.getByPlaceholderText("输入或选词，回车挂上…");
    fireEvent.change(input, { target: { value: "夜行" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.keywordCreate).toHaveBeenCalledWith(1, "夜行"));
    await waitFor(() => expect(api.chapterSetKeywords).toHaveBeenCalledWith(11, [99]));
  });

  it("切章后各控件随章数据重置（key 换绑）", () => {
    useWorkspace.setState({ currentChapterId: 12 });
    render(<MetaDockPanel />);
    expect(screen.getByText("第一章")).toBeInTheDocument();
    const ta = screen.getByPlaceholderText("这一章讲什么（一两句话，导出不带）…") as HTMLTextAreaElement;
    expect(ta.value).toBe("");
    expect(screen.getByText("已写 1200 字")).toBeInTheDocument();
  });

  it("未选章时空态提示", () => {
    useWorkspace.setState({ currentChapterId: null });
    render(<MetaDockPanel />);
    expect(screen.getByText("先选一章")).toBeInTheDocument();
  });
});
