import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChapterMeta, CustomFieldDef, Keyword, Label, Status } from "../../lib/tauri";
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
    customDefsList: vi.fn(),
    customValuesGet: vi.fn(),
    customValueSet: vi.fn(),
    customDefUpsert: vi.fn(),
    customDefDelete: vi.fn(),
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

const DEFS: CustomFieldDef[] = [
  { id: 30, book_id: 1, name: "视角", field_type: "text", list_options: "[]", sort_key: 0, created_at: "" },
  { id: 31, book_id: 1, name: "已审", field_type: "checkbox", list_options: "[]", sort_key: 0, created_at: "" },
  { id: 32, book_id: 1, name: "主线", field_type: "list", list_options: JSON.stringify(["红", "蓝"]), sort_key: 0, created_at: "" },
  { id: 33, book_id: 1, name: "截稿", field_type: "date", list_options: "[]", sort_key: 0, created_at: "" },
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
  useMeta.setState({ labels: LABELS, statuses: STATUSES, keywords: KEYWORDS, chapterKeywords: [KEYWORDS[0]], customDefs: DEFS, customValues: { "30": "第一人称", "31": true, "32": "红" } });
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
  (api.customDefsList as ReturnType<typeof vi.fn>).mockResolvedValue(DEFS);
  (api.customValuesGet as ReturnType<typeof vi.fn>).mockResolvedValue({ "30": "第一人称", "31": true, "32": "红" });
  (api.customValueSet as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (api.customDefUpsert as ReturnType<typeof vi.fn>).mockImplementation(
    (input: Partial<CustomFieldDef> & { name: string }) =>
      Promise.resolve({ id: 98, book_id: 1, field_type: "text", list_options: "[]", sort_key: 0, created_at: "", ...input } as CustomFieldDef),
  );
  (api.customDefDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
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

  it("自定义字段：四型编辑器按当前值渲染", () => {
    render(<MetaDockPanel />);
    // text 型回显
    expect(screen.getByDisplayValue("第一人称")).toBeInTheDocument();
    // checkbox 型按 true 勾选
    const check = screen.getByTestId("custom-value-31") as HTMLInputElement;
    expect(check.checked).toBe(true);
    // list 型 select 选中「红」
    const list = screen.getByTestId("custom-value-32") as HTMLSelectElement;
    expect(list.value).toBe("红");
    // date 型无值渲染空 input
    const date = screen.getByTestId("custom-value-33") as HTMLInputElement;
    expect(date.value).toBe("");
  });

  it("自定义字段：改值即保存 customValueSet（checkbox 翻转 + text 失焦写串/清空写 null）", async () => {
    render(<MetaDockPanel />);

    fireEvent.click(screen.getByTestId("custom-value-31"));
    await waitFor(() => expect(api.customValueSet).toHaveBeenCalledWith(11, 31, false));

    const text = screen.getByTestId("custom-value-30");
    fireEvent.change(text, { target: { value: "第三人称" } });
    fireEvent.blur(text);
    await waitFor(() => expect(api.customValueSet).toHaveBeenCalledWith(11, 30, "第三人称"));

    // 保存后 store 更新触发 key 重挂，需重取节点；清空 = 写 null
    const text2 = screen.getByTestId("custom-value-30");
    fireEvent.change(text2, { target: { value: "" } });
    fireEvent.blur(text2);
    await waitFor(() => expect(api.customValueSet).toHaveBeenCalledWith(11, 30, null));
  });

  it("自定义字段：列表下拉换选项即保存；新建字段（list 型带选项）走定义 upsert", async () => {
    render(<MetaDockPanel />);

    fireEvent.change(screen.getByTestId("custom-value-32"), { target: { value: "蓝" } });
    await waitFor(() => expect(api.customValueSet).toHaveBeenCalledWith(11, 32, "蓝"));

    // 打开管理定义区
    fireEvent.click(screen.getByText("管理定义"));
    fireEvent.change(screen.getByPlaceholderText("新字段名…"), { target: { value: "结局" } });
    fireEvent.change(screen.getByRole("combobox", { name: "字段类型" }), { target: { value: "list" } });
    fireEvent.change(screen.getByPlaceholderText("新字段的选项，逗号分隔"), { target: { value: "圆满，悲剧" } });
    fireEvent.click(screen.getByTitle("新增字段"));

    await waitFor(() =>
      expect(api.customDefUpsert).toHaveBeenCalledWith({
        id: null, book_id: 1, name: "结局", field_type: "list",
        list_options: JSON.stringify(["圆满", "悲剧"]), sort_key: 0,
      }),
    );
  });

  it("自定义字段：定义改名与删除（管理区内完成）", async () => {
    render(<MetaDockPanel />);
    fireEvent.click(screen.getByText("管理定义"));

    const nameInput = screen.getByDisplayValue("视角");
    fireEvent.change(nameInput, { target: { value: "叙事视角" } });
    fireEvent.blur(nameInput);
    await waitFor(() =>
      expect(api.customDefUpsert).toHaveBeenCalledWith({
        id: 30, book_id: 1, name: "叙事视角", field_type: "text", list_options: "[]", sort_key: 0,
      }),
    );

    // 删除「截稿」：从其定义行（含该名输入框的 div）里找删除钮
    const row = screen.getByDisplayValue("截稿").closest("div")!;
    fireEvent.click(row.querySelector('button[title^="删除字段"]')!);
    await waitFor(() => expect(api.customDefDelete).toHaveBeenCalledWith(33));
  });

  it("未选章时空态提示", () => {
    useWorkspace.setState({ currentChapterId: null });
    render(<MetaDockPanel />);
    expect(screen.getByText("先选一章")).toBeInTheDocument();
  });
});
