import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GeneratedName } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: { namesGenerate: vi.fn() },
}));

import { api } from "../../lib/tauri";
import { NamesPanel } from "./NamesPanel";

const NAMES: GeneratedName[] = [
  { full: "沈青临", surname: "沈", given: "青临", gender: "male", rare: false },
  { full: "慕容雪", surname: "慕容", given: "雪", gender: "female", rare: true },
];

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  vi.clearAllMocks();
  // happy-dom 的 navigator.clipboard 是 getter-only，得用 defineProperty 替身
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

describe("NamesPanel（M7 批次7 取名）", () => {
  it("生成：把控制面约束传给 namesGenerate 并渲染结果列表", async () => {
    (api.namesGenerate as ReturnType<typeof vi.fn>).mockResolvedValue(NAMES);
    render(<NamesPanel />);

    fireEvent.change(screen.getByRole("combobox", { name: "性别" }), { target: { value: "female" } });
    fireEvent.change(screen.getByRole("combobox", { name: "生僻度" }), { target: { value: "rare" } });
    fireEvent.change(screen.getByPlaceholderText("开头一字（可空）"), { target: { value: "沈" } });
    fireEvent.change(screen.getByPlaceholderText("含有一字（可空）"), { target: { value: "雪" } });
    fireEvent.click(screen.getByTestId("names-generate"));

    await waitFor(() =>
      expect(api.namesGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ gender: "female", obscurity: "rare", starts_with: "沈", contains: "雪" }),
      ),
    );
    expect(screen.getAllByTestId("names-result")).toHaveLength(2);
    expect(screen.getByText("沈青临")).toBeInTheDocument();
    expect(screen.getByText("慕容雪")).toBeInTheDocument();
    expect(screen.getByText("女 · 生僻")).toBeInTheDocument();
  });

  it("数量钳制在 1~50；结果为空给放宽提示", async () => {
    (api.namesGenerate as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<NamesPanel />);

    const count = screen.getByTestId("names-count") as HTMLInputElement;
    fireEvent.change(count, { target: { value: "999" } });
    expect(count.value).toBe("50");
    fireEvent.click(screen.getByTestId("names-generate"));

    await waitFor(() => expect(api.namesGenerate).toHaveBeenCalledWith(expect.objectContaining({ count: 50 })));
    expect(screen.getByText("约束太紧没凑够，放宽一点再试。")).toBeInTheDocument();
  });

  it("点结果复制全名并给出已复制反馈", async () => {
    (api.namesGenerate as ReturnType<typeof vi.fn>).mockResolvedValue(NAMES);
    render(<NamesPanel />);
    fireEvent.click(screen.getByTestId("names-generate"));
    await screen.findByText("沈青临");

    fireEvent.click(screen.getByText("沈青临"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("沈青临"));
    expect(screen.getByText("已复制")).toBeInTheDocument();
  });
});
