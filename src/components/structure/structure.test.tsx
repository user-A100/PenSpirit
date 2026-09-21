import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta, ChapterTemplate, Keyword, Label, Status } from "../../lib/tauri";
import { useWorkspace } from "../../stores/workspace";
import { useMeta } from "../../stores/meta";
import { useTemplates } from "../../stores/templates";
import { useUiNav } from "../../lib/nav/uiStore";

vi.mock("../../lib/tauri", () => ({
  api: {
    labelsList: vi.fn(),
    statusesList: vi.fn(),
    keywordsList: vi.fn(),
    keywordsForChapter: vi.fn(),
    readChapter: vi.fn(),
    reorderChapters: vi.fn(),
    templatesList: vi.fn(),
    templateUpsert: vi.fn(),
    templateDelete: vi.fn(),
    templateSetDefault: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { Corkboard } from "./Corkboard";
import { OutlinerTable } from "./OutlinerTable";
import { Scrivenings } from "./Scrivenings";
import { TemplateModal } from "./TemplateModal";

const LABELS: Label[] = [{ id: 1, book_id: 1, title: "红", color: "#f87171", sort_key: 0, created_at: "" }];
const STATUSES: Status[] = [
  { id: 10, book_id: 1, title: "待写", sort_key: 0, created_at: "" },
  { id: 11, book_id: 1, title: "写作中", sort_key: 1, created_at: "" },
];
const KEYWORDS: Keyword[] = [];

function ch(p: Partial<ChapterMeta> & Pick<ChapterMeta, "id" | "title" | "sort_key">): ChapterMeta {
  return {
    book_id: 1, file_path: "", word_count: 0,
    created_at: "", updated_at: "", synopsis: "", label_id: null, status_id: null,
    target_words: null, ...p,
  };
}

const CH1 = ch({ id: 11, title: "甲", sort_key: 1, word_count: 300, synopsis: "甲的梗概", status_id: 10, target_words: 1000 });
const CH2 = ch({ id: 12, title: "乙", sort_key: 2, word_count: 100 });
const CH3 = ch({ id: 13, title: "丙", sort_key: 3, word_count: 200, synopsis: "丙的梗概", label_id: 1 });

const TPL: ChapterTemplate = { id: 5, book_id: 1, name: "战斗章", content: "## 战斗", is_default: true, created_at: "", updated_at: "" };

function mock() {
  (api.labelsList as ReturnType<typeof vi.fn>).mockResolvedValue(LABELS);
  (api.statusesList as ReturnType<typeof vi.fn>).mockResolvedValue(STATUSES);
  (api.keywordsList as ReturnType<typeof vi.fn>).mockResolvedValue(KEYWORDS);
  (api.keywordsForChapter as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.readChapter as ReturnType<typeof vi.fn>).mockResolvedValue({ meta: CH1, content: "" });
  (api.templatesList as ReturnType<typeof vi.fn>).mockResolvedValue([TPL]);
  (api.reorderChapters as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.templateUpsert as ReturnType<typeof vi.fn>).mockImplementation((input: Partial<ChapterTemplate>) =>
    Promise.resolve({ id: input.id ?? 99, book_id: 1, name: input.name ?? "", content: input.content ?? "", is_default: input.is_default ?? false, created_at: "", updated_at: "" }),
  );
  (api.templateDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.templateSetDefault as ReturnType<typeof vi.fn>).mockImplementation((id: number, isDefault: boolean) =>
    Promise.resolve({ ...TPL, id, is_default: isDefault }),
  );
}

function resetStores(chapters = [CH1, CH2, CH3]) {
  useWorkspace.setState({ books: [], chapters, currentBookId: 1, currentChapterId: 11, chapterContent: null, error: null });
  useMeta.setState({ labels: LABELS, statuses: STATUSES, keywords: KEYWORDS, chapterKeywords: [] });
  useTemplates.setState({ list: [TPL] });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  // 先备好 mock 再动 store：workspace.setState 会同步触发 meta/templates 订阅拉取
  mock();
  resetStores();
});

async function rowOrder(container: HTMLElement): Promise<string[]> {
  const rows = container.querySelectorAll(".flex-1.overflow-y-auto > div");
  return [...rows].map((r) => r.querySelector("span.flex-1")?.textContent ?? "");
}

describe("Corkboard 卡片墙", () => {
  it("渲染卡片：标题/梗概/状态章/字数/标签点", () => {
    const { container } = render(<Corkboard />);
    expect(screen.getByText("甲")).toBeInTheDocument();
    expect(screen.getByText("甲的梗概")).toBeInTheDocument();
    expect(screen.getByText("待写")).toBeInTheDocument(); // 状态 chip
    expect(container.querySelector('[style*="rgb(248, 113, 113)"], [style*="#f87171"]')).not.toBeNull(); // 标签色点
    expect(screen.getByText("300 字")).toBeInTheDocument();
  });

  it("空书空态提示", () => {
    useWorkspace.setState({ chapters: [] });
    render(<Corkboard />);
    expect(screen.getByText(/还没有章节/)).toBeInTheDocument();
  });

  it("双击卡片：选中该章并跳写作视图", async () => {
    render(<Corkboard />);
    fireEvent.doubleClick(screen.getByText("乙"));
    await waitFor(() => {
      expect(useWorkspace.getState().currentChapterId).toBe(12);
      expect(useUiNav.getState().activeView).toBe("write");
    });
  });

  it("拖拽换序：乐观更新 chapters 并调 API；失败回滚", async () => {
    render(<Corkboard />);
    fireEvent.dragStart(screen.getByText("甲").closest("div.h-32")!);
    fireEvent.drop(screen.getByText("丙").closest("div.h-32")!);

    await waitFor(() => expect(api.reorderChapters).toHaveBeenCalledWith([12, 13, 11]));
    await waitFor(() => {
      expect(useWorkspace.getState().chapters.map((c) => c.title)).toEqual(["乙", "丙", "甲"]);
    });

    // 失败回滚到拖拽前
    (api.reorderChapters as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    fireEvent.dragStart(screen.getByText("乙").closest("div.h-32")!);
    fireEvent.drop(screen.getByText("甲").closest("div.h-32")!);
    await waitFor(() => {
      expect(useWorkspace.getState().chapters.map((c) => c.title)).toEqual(["乙", "丙", "甲"]);
      expect(useWorkspace.getState().error).toBeTruthy();
    });
  });
});

describe("OutlinerTable 大纲列", () => {
  it("渲染行：序号/标题/标签/状态/字数/进度", () => {
    render(<OutlinerTable />);
    expect(screen.getByText("甲")).toBeInTheDocument();
    expect(screen.getByText("红")).toBeInTheDocument(); // 标签（丙挂着）
    expect(screen.getByText("待写")).toBeInTheDocument(); // 状态（甲挂着）
    expect(screen.getByText("30%")).toBeInTheDocument(); // 甲 300/1000
  });

  it("点表头排序是视图透镜：改显示序不回写 chapters；三击循环回目录序", async () => {
    const { container } = render(<OutlinerTable />);
    expect(await rowOrder(container)).toEqual(["甲", "乙", "丙"]);

    fireEvent.click(screen.getByText("字数"));
    expect(await rowOrder(container)).toEqual(["乙", "丙", "甲"]); // 升序
    expect(useWorkspace.getState().chapters.map((c) => c.title)).toEqual(["甲", "乙", "丙"]); // 目录序未动

    fireEvent.click(screen.getByText("字数"));
    expect(await rowOrder(container)).toEqual(["甲", "丙", "乙"]); // 降序

    fireEvent.click(screen.getByText("字数"));
    expect(await rowOrder(container)).toEqual(["甲", "乙", "丙"]); // 回目录序
  });

  it("标题表头按中文 collator 排序；恢复目录序按钮", async () => {
    const { container } = render(<OutlinerTable />);
    fireEvent.click(screen.getByText("标题"));
    expect(await rowOrder(container)).toEqual(["丙", "甲", "乙"]); // zh: 丙<甲<乙 拼音序（bing<jia<yi）

    fireEvent.click(screen.getByTitle("恢复目录序"));
    expect(await rowOrder(container)).toEqual(["甲", "乙", "丙"]);
  });

  it("排序态下禁用拖拽换序", () => {
    render(<OutlinerTable />);
    fireEvent.click(screen.getByText("字数"));
    const row = screen.getByText("甲").parentElement!;
    expect(row.getAttribute("draggable")).toBe("false");
  });

  it("双击行跳写作视图", async () => {
    render(<OutlinerTable />);
    fireEvent.doubleClick(screen.getByText("丙"));
    await waitFor(() => {
      expect(useWorkspace.getState().currentChapterId).toBe(13);
      expect(useUiNav.getState().activeView).toBe("write");
    });
  });
});

describe("Scrivenings 串烧", () => {
  it("按目录序拼接全文：标题 + 正文，章间横线", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockImplementation((id: number) =>
      Promise.resolve({ meta: { id, title: id === 11 ? "甲" : id === 12 ? "乙" : "丙" }, content: id === 11 ? "甲正文" : id === 12 ? "乙正文" : "丙正文" }),
    );
    const { container } = render(<Scrivenings />);
    await waitFor(() => expect(screen.getByText("甲正文")).toBeInTheDocument());
    const a = screen.getByText("甲正文");
    const b = screen.getByText("乙正文");
    const c = screen.getByText("丙正文");
    expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(b.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll("hr")).toHaveLength(2);
  });

  it("空章列表停在拼接提示", () => {
    useWorkspace.setState({ chapters: [] });
    render(<Scrivenings />);
    expect(screen.getByText("正在拼接全文…")).toBeInTheDocument();
  });

  it("读取失败展示错误", async () => {
    (api.readChapter as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("disk gone"));
    render(<Scrivenings />);
    await waitFor(() => expect(screen.getByText(/disk gone/)).toBeInTheDocument());
  });
});

describe("TemplateModal 章节模板", () => {
  it("渲染模板清单与右列提示", () => {
    render(<TemplateModal open onClose={() => {}} />);
    expect(screen.getByText("战斗章")).toBeInTheDocument(); // 清单项
    expect(screen.getByText(/左侧选择模板编辑/)).toBeInTheDocument(); // 右列未编辑时提示
    expect(screen.getByTitle("把当前章的正文存为新模板")).toBeInTheDocument(); // 有选中章时出现
  });

  it("新建模板：填名字保存调 upsert 并入列", async () => {
    render(<TemplateModal open onClose={() => {}} />);
    fireEvent.click(screen.getByText("新建模板"));
    fireEvent.change(screen.getByPlaceholderText(/模板名/), { target: { value: "日常章" } });
    fireEvent.click(screen.getByTitle("保存模板"));

    await waitFor(() =>
      expect(api.templateUpsert).toHaveBeenCalledWith({ id: null, book_id: 1, name: "日常章", content: "", is_default: false }),
    );
    await waitFor(() => expect(screen.getByText("日常章")).toBeInTheDocument());
  });

  it("点清单编辑既有模板：保留 id 保存；设默认/取消默认调 API；删除出列", async () => {
    render(<TemplateModal open onClose={() => {}} />);

    // 点清单项 → 右列载入该模板
    fireEvent.click(screen.getByText("战斗章"));
    const nameInput = screen.getByDisplayValue("战斗章") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "战斗章·改" } });
    fireEvent.click(screen.getByTitle("保存模板"));
    await waitFor(() =>
      expect(api.templateUpsert).toHaveBeenCalledWith(expect.objectContaining({ id: 5, name: "战斗章·改" })),
    );

    // 取消默认（TPL 原为默认）
    fireEvent.click(screen.getByTitle("取消默认"));
    await waitFor(() => expect(api.templateSetDefault).toHaveBeenCalledWith(5, false));

    // 删除
    fireEvent.click(screen.getByTitle("删除模板"));
    await waitFor(() => expect(api.templateDelete).toHaveBeenCalledWith(5));
    await waitFor(() => expect(useTemplates.getState().list).toHaveLength(0));
  });

  it("当前章存为模板：取 workspace.chapterContent 作为骨架", async () => {
    useWorkspace.setState({ chapterContent: "## 已写一半" });
    render(<TemplateModal open onClose={() => {}} />);
    fireEvent.click(screen.getByTitle("把当前章的正文存为新模板"));

    await waitFor(() =>
      expect(api.templateUpsert).toHaveBeenCalledWith({ id: null, book_id: 1, name: "甲 模板", content: "## 已写一半", is_default: false }),
    );
  });
});
