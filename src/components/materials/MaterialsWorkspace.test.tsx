import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Material } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    materialsList: vi.fn(),
    materialUpsert: vi.fn(),
    materialDelete: vi.fn(),
  },
}));

import { api } from "../../lib/tauri";
import { useMaterials } from "../../stores/materials";
import { MaterialsWorkspace } from "./MaterialsWorkspace";

// ---- 夹具：后端按 (分类, updated_at DESC) 排好，同分类相邻 ----
function mat(p: Partial<Material> & Pick<Material, "id" | "title">): Material {
  return { category: "", content: "", tags: "", created_at: "2026-09-01 00:00:00", updated_at: "2026-09-01 00:00:00", ...p };
}

const LIST: Material[] = [
  mat({ id: 301, title: "幽冥湖", category: "地名", content: "湖底沉着一座古城", tags: "秘境,禁地" }),
  mat({ id: 302, title: "落霞宗", category: "地名", tags: "门派" }),
  mat({ id: 303, title: "三尺青锋", content: "主角佩剑，剑灵会吐槽" }),
];

const waitDebounce = () => new Promise((r) => setTimeout(r, 350));

beforeEach(() => {
  vi.clearAllMocks();
  (api.materialsList as ReturnType<typeof vi.fn>).mockResolvedValue(LIST);
  (api.materialUpsert as ReturnType<typeof vi.fn>).mockResolvedValue(LIST[0]);
  (api.materialDelete as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  useMaterials.setState({ query: "", list: [] });
});

describe("MaterialsWorkspace", () => {
  it("按分类分组渲染：组标题 + 计数 + 内容 + 标签；空分类兜底「未分类」", async () => {
    render(<MaterialsWorkspace />);

    expect(await screen.findByText("幽冥湖")).toBeInTheDocument();
    expect(screen.getByText("地名")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // 地名组计数
    expect(screen.getByText("未分类")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();

    expect(screen.getByText("湖底沉着一座古城")).toBeInTheDocument();
    expect(screen.getByText("三尺青锋")).toBeInTheDocument();
    // 标签拆分渲染
    expect(screen.getByText("秘境")).toBeInTheDocument();
    expect(screen.getByText("禁地")).toBeInTheDocument();
  });

  it("搜索防抖 300ms 后带 query 重取", async () => {
    render(<MaterialsWorkspace />);
    await screen.findByText("幽冥湖");
    (api.materialsList as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.change(screen.getByPlaceholderText(/搜素材/), { target: { value: "湖" } });
    expect(api.materialsList).not.toHaveBeenCalled(); // 防抖期内不请求
    await waitDebounce();
    await waitFor(() => expect(api.materialsList).toHaveBeenCalledWith("湖"));
  });

  it("新建：标题必填控制保存，保存成功关表单并重取", async () => {
    render(<MaterialsWorkspace />);
    await screen.findByText("幽冥湖");

    fireEvent.click(screen.getByText("新建"));
    const save = screen.getByText("保存");
    expect(save).toBeDisabled(); // 标题空 → 不可保存

    fireEvent.change(screen.getByPlaceholderText(/素材名/), { target: { value: "听雨楼" } });
    fireEvent.change(screen.getByPlaceholderText("分类（如：地名）"), { target: { value: "地名" } });
    fireEvent.change(screen.getByPlaceholderText("标签（逗号分隔）"), { target: { value: "情报网" } });
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() =>
      expect(api.materialUpsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: null, title: "听雨楼", category: "地名", tags: "情报网" }),
      ),
    );
    await waitFor(() => expect(screen.queryByText("保存")).not.toBeInTheDocument());
    expect(api.materialsList).toHaveBeenCalled();
  });

  it("编辑回填：点卡片编辑进入表单带出原值", async () => {
    render(<MaterialsWorkspace />);
    const card = (await screen.findByText("幽冥湖")).closest("div.group") as HTMLElement;
    fireEvent.click(within(card).getByTitle("编辑"));

    expect(screen.getByPlaceholderText(/素材名/)).toHaveValue("幽冥湖");
    expect(screen.getByPlaceholderText("分类（如：地名）")).toHaveValue("地名");
    expect(screen.getByPlaceholderText("标签（逗号分隔）")).toHaveValue("秘境,禁地");
  });

  it("删除两步确认：第一次点垃圾桶只出现「确认」，再点才调删除", async () => {
    render(<MaterialsWorkspace />);
    const card = (await screen.findByText("幽冥湖")).closest("div.group") as HTMLElement;
    fireEvent.click(within(card).getByTitle("删除"));

    expect(api.materialDelete).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByText("确认"));
    await waitFor(() => expect(api.materialDelete).toHaveBeenCalledWith(301));
  });

  it("空态：无结果显示「没有匹配的素材」", async () => {
    (api.materialsList as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<MaterialsWorkspace />);
    expect(await screen.findByText("素材库还是空的")).toBeInTheDocument();
  });
});
