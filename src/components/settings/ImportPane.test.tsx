import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ImportPane } from "./ImportPane";
import { api } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: { settingGet: vi.fn(), settingSet: vi.fn() },
}));

beforeEach(() => {
  vi.mocked(api.settingGet).mockResolvedValue(null);
  vi.mocked(api.settingSet).mockReset();
});

describe("ImportPane 自定义分章规则", () => {
  it("已存规则回显；删除后落库空数组", async () => {
    vi.mocked(api.settingGet).mockResolvedValue('[{"name":"卷头","pattern":"^卷一$"}]');
    render(createElement(ImportPane));
    expect(await screen.findByDisplayValue("^卷一$")).toBeInTheDocument();

    fireEvent.click(screen.getByTitle("删除"));
    expect(api.settingSet).toHaveBeenCalledWith("customChapterRules", "[]");
  });

  it("无效正则拒绝并提示，不入库", async () => {
    render(createElement(ImportPane));
    fireEvent.change(screen.getByPlaceholderText("规则名"), { target: { value: "坏" } });
    fireEvent.change(screen.getByPlaceholderText("如：^【.+】$"), { target: { value: "(" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(await screen.findByText(/正则无效/)).toBeInTheDocument();
    expect(api.settingSet).not.toHaveBeenCalled();
  });

  it("添加合法规则即落库并清空输入", async () => {
    render(createElement(ImportPane));
    fireEvent.change(screen.getByPlaceholderText("规则名"), { target: { value: "卷头" } });
    fireEvent.change(screen.getByPlaceholderText("如：^【.+】$"), { target: { value: "^卷[一二三]$" } });
    fireEvent.click(screen.getByRole("button", { name: /添加/ }));
    expect(await screen.findByDisplayValue("^卷[一二三]$")).toBeInTheDocument();
    expect(api.settingSet).toHaveBeenCalledWith(
      "customChapterRules",
      '[{"name":"卷头","pattern":"^卷[一二三]$"}]',
    );
  });
});
