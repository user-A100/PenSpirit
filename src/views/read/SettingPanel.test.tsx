import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { api, type BgImage } from "../../lib/tauri";
import { defaultReadingPrefs, useReadingPrefs } from "./readingPrefs";
import { SettingPanel } from "./SettingPanel";

// convertFileSrc 走 asset 协议，测试里替换为可断言的确定性映射
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://mock/${p}`,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../lib/tauri", () => ({
  api: {
    readingBgList: vi.fn(),
    readingBgImport: vi.fn(),
    readingBgDelete: vi.fn(),
  },
}));

function bg(id: string, name: string): BgImage {
  return { id, path: `C:/appdata/background/${id}-${name}.png`, name };
}

const IMAGES: BgImage[] = [bg("aaa", "山间晨雾"), bg("bbb", "夜航船")];

function resetPrefs() {
  useReadingPrefs.setState({ ...defaultReadingPrefs });
}

describe("SettingPanel", () => {
  let confirmMock: Mock;
  let scrollIntoViewMock: Mock;

  beforeEach(() => {
    localStorage.clear();
    resetPrefs();
    confirmMock = vi.fn(() => true);
    (window as unknown as { confirm: unknown }).confirm = confirmMock;
    scrollIntoViewMock = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewMock as unknown as Element["scrollIntoView"];
    vi.mocked(api.readingBgList).mockResolvedValue(IMAGES);
    vi.mocked(api.readingBgImport).mockReset();
    vi.mocked(api.readingBgDelete).mockReset();
    vi.mocked(openFileDialog).mockReset();
  });

  afterEach(() => {
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it("挂载拉取背景图列表并渲染缩略图", async () => {
    render(<SettingPanel />);
    await waitFor(() => {
      expect(screen.getByLabelText("背景图 山间晨雾")).toBeInTheDocument();
      expect(screen.getByLabelText("背景图 夜航船")).toBeInTheDocument();
    });
    expect(api.readingBgList).toHaveBeenCalledTimes(1);
  });

  it("点缩略图选用背景图写入 prefs，再点取消", async () => {
    render(<SettingPanel />);
    await waitFor(() => screen.getByLabelText("背景图 山间晨雾"));

    fireEvent.click(screen.getByLabelText("背景图 山间晨雾"));
    expect(useReadingPrefs.getState().bgImage).toEqual({
      id: "aaa",
      path: "C:/appdata/background/aaa-山间晨雾.png",
    });

    // 选中后出现不透明度滑条
    expect(screen.getByLabelText("背景图不透明度")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("背景图 山间晨雾"));
    expect(useReadingPrefs.getState().bgImage).toBeNull();
    // 取消后不透明度滑条隐藏
    expect(screen.queryByLabelText("背景图不透明度")).toBeNull();
  });

  it("缩略图角上 × 删除：confirm 确认后调 Rust 删除并刷新；选中项被删时清 bgImage", async () => {
    render(<SettingPanel />);
    await waitFor(() => screen.getByLabelText("删除背景图 山间晨雾"));
    fireEvent.click(screen.getByLabelText("背景图 山间晨雾"));
    expect(useReadingPrefs.getState().bgImage?.id).toBe("aaa");

    vi.mocked(api.readingBgDelete).mockResolvedValue(undefined);
    // 删除后列表刷新只剩另一张
    vi.mocked(api.readingBgList).mockResolvedValue([IMAGES[1]]);
    fireEvent.click(screen.getByLabelText("删除背景图 山间晨雾"));

    await waitFor(() => expect(api.readingBgDelete).toHaveBeenCalledWith("aaa"));
    await waitFor(() => expect(useReadingPrefs.getState().bgImage).toBeNull());
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining("山间晨雾"));
  });

  it("confirm 取消时不删除", async () => {
    confirmMock.mockReturnValue(false);
    render(<SettingPanel />);
    await waitFor(() => screen.getByLabelText("删除背景图 夜航船"));
    fireEvent.click(screen.getByLabelText("删除背景图 夜航船"));
    expect(api.readingBgDelete).not.toHaveBeenCalled();
  });

  it("导入按钮：文件对话框选路径 → readingBgImport → 列表刷新", async () => {
    const imported = bg("ccc", "新图");
    vi.mocked(openFileDialog).mockResolvedValue("C:/pics/新图.png");
    vi.mocked(api.readingBgImport).mockResolvedValue(imported);
    vi.mocked(api.readingBgList)
      .mockResolvedValueOnce(IMAGES)
      .mockResolvedValueOnce([...IMAGES, imported]);
    render(<SettingPanel />);

    fireEvent.click(screen.getByRole("button", { name: /导入/ }));
    await waitFor(() => expect(api.readingBgImport).toHaveBeenCalledWith("C:/pics/新图.png"));
    await waitFor(() => expect(api.readingBgList).toHaveBeenCalledTimes(2));
  });

  it("选预设圆色圈写 prefs 配色", () => {
    render(<SettingPanel />);
    fireEvent.click(screen.getByLabelText("配色预设 暗夜"));
    expect(useReadingPrefs.getState().bgColor).toBe("#1a1a1a");
    expect(useReadingPrefs.getState().textColor).toBe("#d8d8d8");

    fireEvent.click(screen.getByLabelText("配色预设 护眼绿"));
    expect(useReadingPrefs.getState().bgColor).toBe("#cfe8d0");
    expect(useReadingPrefs.getState().textColor).toBe("#2d4a33");
  });

  it("排版滑条即时写 prefs", () => {
    render(<SettingPanel />);
    fireEvent.change(screen.getByRole("slider", { name: "字号" }), { target: { value: "22" } });
    expect(useReadingPrefs.getState().fontSize).toBe(22);

    fireEvent.change(screen.getByRole("slider", { name: "行距" }), { target: { value: "1" } });
    expect(useReadingPrefs.getState().lineHeight).toBe(1.25);

    fireEvent.change(screen.getByRole("slider", { name: "页宽" }), { target: { value: "860" } });
    expect(useReadingPrefs.getState().pageWidth).toBe(860);
  });

  it("字体下拉/对齐/缩进开关写 prefs", () => {
    render(<SettingPanel />);
    fireEvent.change(screen.getByLabelText("字体"), { target: { value: "kai" } });
    expect(useReadingPrefs.getState().fontFamily).toBe("kai");

    fireEvent.click(screen.getByLabelText("左对齐"));
    expect(useReadingPrefs.getState().textAlign).toBe("left");
    fireEvent.click(screen.getByLabelText("两端对齐"));
    expect(useReadingPrefs.getState().textAlign).toBe("justify");

    fireEvent.click(screen.getByLabelText("首行缩进"));
    expect(useReadingPrefs.getState().indent).toBe(false);
  });

  it("设置搜索：输入命中标题 → 定位分区滚入并挂 setting-hit 高亮", () => {
    render(<SettingPanel />);
    fireEvent.change(screen.getByPlaceholderText(/搜索设置/), { target: { value: "排版" } });

    const typography = document.querySelector('[data-search-key="typography"]');
    expect(typography).not.toBeNull();
    expect(typography?.classList.contains("setting-hit")).toBe(true);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

    // 其它分区不高亮
    const colors = document.querySelector('[data-search-key="colors"]');
    expect(colors?.classList.contains("setting-hit")).toBe(false);
  });

  it("设置搜索：子序列也命中（前缀更优），无命中不高亮不滚动", () => {
    render(<SettingPanel />);

    // 前缀命中背景图
    fireEvent.change(screen.getByPlaceholderText(/搜索设置/), { target: { value: "背景" } });
    expect(
      document.querySelector('[data-search-key="bgimage"]')?.classList.contains("setting-hit"),
    ).toBe(true);

    // 子序列命中字体与对齐
    fireEvent.change(screen.getByPlaceholderText(/搜索设置/), { target: { value: "对齐" } });
    expect(
      document.querySelector('[data-search-key="font"]')?.classList.contains("setting-hit"),
    ).toBe(true);

    // 无命中
    scrollIntoViewMock.mockClear();
    fireEvent.change(screen.getByPlaceholderText(/搜索设置/), { target: { value: "zzz不存在" } });
    document.querySelectorAll("[data-search-key]").forEach((el) => {
      expect(el.classList.contains("setting-hit")).toBe(false);
    });
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    // 清空同样不高亮
    fireEvent.change(screen.getByPlaceholderText(/搜索设置/), { target: { value: "" } });
    expect(document.querySelector('[data-search-key="typography"]')?.classList.contains("setting-hit")).toBe(false);
  });
});
