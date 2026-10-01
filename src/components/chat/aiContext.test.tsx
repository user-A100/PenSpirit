import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ContextPreview } from "./ContextPreview";
import { MemoryRules } from "./MemoryRules";
import { AiHiddenToggle } from "../ui/AiHiddenToggle";
import { MenuHost } from "../ui/MenuHost";
import { useWorkspace } from "../../stores/workspace";
import { buildTurnOptions, useChat } from "../../stores/chat";
import type { AssemblyLog, WritingRule } from "../../lib/tauri";

vi.mock("../../lib/tauri", () => ({
  api: {
    labelsList: vi.fn().mockResolvedValue([]),
    statusesList: vi.fn().mockResolvedValue([]),
    keywordsList: vi.fn().mockResolvedValue([]),
    keywordsForChapter: vi.fn().mockResolvedValue([]),
    customDefsList: vi.fn().mockResolvedValue([]),
    customValuesGet: vi.fn().mockResolvedValue({}),
    templatesList: vi.fn().mockResolvedValue([]),
    contextConfigGet: vi.fn(),
    contextConfigSet: vi.fn().mockResolvedValue(undefined),
    plotBlocksList: vi.fn().mockResolvedValue([]),
    ideasList: vi.fn().mockResolvedValue([]),
    aiMemoryGet: vi.fn(),
    aiMemorySet: vi.fn().mockResolvedValue(undefined),
    rulesList: vi.fn(),
    ruleUpsert: vi.fn(),
    ruleDelete: vi.fn().mockResolvedValue(undefined),
    cardSetAiHidden: vi.fn().mockResolvedValue(undefined),
  },
}));

import { api } from "../../lib/tauri";

const LOG: AssemblyLog = {
  slots: [
    { name: "角色卡", source: "关键词命中 1 人", chars: 20, est_tokens: 32, preview_head: "- 林远山（主角）", reason: "正文提到：林远山" },
    { name: "灵感卡", source: "全部 2 张", chars: 400, est_tokens: 600, preview_head: "- 雪", trimmed: true, reason: "注入设置开了「全部灵感卡」——超出上下文预算 500，本轮未发送" },
  ],
  total_est_tokens: 420,
  budget_tokens: 500,
};

beforeEach(() => {
  useWorkspace.setState({ currentBookId: 1, currentChapterId: 7, chapters: [], volumes: [] });
});

describe("ContextPreview · 为何包含 / 预算（阶段 2B）", () => {
  it("每个槽位显示来由；超预算被裁的标出；预算条列出已裁槽位", () => {
    render(<ContextPreview log={LOG} loading={false} />);
    expect(screen.getByText("为何包含：正文提到：林远山")).toBeInTheDocument();
    expect(screen.getByText("超预算已裁")).toBeInTheDocument();
    expect(screen.getByTestId("budget-bar")).toHaveTextContent("420 / 500");
    expect(screen.getByText("超出预算，本轮已裁：灵感卡")).toBeInTheDocument();
  });

  it("注入设置里可改上下文预算", async () => {
    (api.contextConfigGet as Mock).mockResolvedValue({
      characters: { enabled: true, budget: 1500, ids: null, all: false },
      foreshadows: { enabled: true, budget: 800, ids: null, all: false },
      plots: { enabled: false, budget: 1000, ids: null, all: false },
      ideas: { enabled: false, budget: 600, ids: null, all: false },
      budget_tokens: 16000,
    });
    render(<ContextPreview log={null} loading={false} />);
    fireEvent.click(screen.getByText("注入设置"));
    const input = await screen.findByTestId("inj-budget-total");
    fireEvent.change(input, { target: { value: "8000" } });
    await waitFor(() => expect(api.contextConfigSet).toHaveBeenCalledWith(1, expect.objectContaining({ budget_tokens: 8000 })));
  });
});

describe("记忆与规则（阶段 2B）", () => {
  it("本书 / 本卷记忆与作者注失焦即存；新建规则、切换作用方式", async () => {
    (api.aiMemoryGet as Mock).mockResolvedValue({ book: "基调冷峻", volume_id: 30, volume_title: "第一卷", volume: "", chapter_note: "" });
    const rules: WritingRule[] = [];
    (api.rulesList as Mock).mockImplementation(async () => [...rules]);
    (api.ruleUpsert as Mock).mockImplementation(async (input) => {
      const r = { ...input, id: input.id ?? 99, sort_key: 1, created_at: "" };
      const i = rules.findIndex((x) => x.id === r.id);
      if (i >= 0) rules[i] = r;
      else rules.push(r);
      return r;
    });
    const changed = vi.fn();
    render(
      <>
        <MemoryRules onChanged={changed} />
        <MenuHost />
      </>,
    );
    const book = await screen.findByTestId("memory-book");
    expect((book as HTMLTextAreaElement).value).toBe("基调冷峻");
    fireEvent.change(screen.getByTestId("memory-volume"), { target: { value: "本卷在北境" } });
    fireEvent.blur(screen.getByTestId("memory-volume"));
    await waitFor(() => expect(api.aiMemorySet).toHaveBeenCalledWith("volume", 30, "本卷在北境"));
    fireEvent.change(screen.getByTestId("memory-chapter"), { target: { value: "这段要虐" } });
    fireEvent.blur(screen.getByTestId("memory-chapter"));
    await waitFor(() => expect(api.aiMemorySet).toHaveBeenCalledWith("chapter", 7, "这段要虐"));
    expect(changed).toHaveBeenCalled();

    fireEvent.click(screen.getByText("新建规则"));
    await screen.findByDisplayValue("新规则");
    fireEvent.click(screen.getByText("全书常驻"));
    fireEvent.click(await screen.findByText("手动选用"));
    await waitFor(() => expect(api.ruleUpsert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 99, mode: "manual" })));
  });

  it("手选规则进入本轮请求参数，发送后清空", () => {
    act(() => useChat.getState().toggleRule(5));
    expect(buildTurnOptions({}).rules).toEqual([5]);
    act(() => useChat.getState().toggleRule(5));
    expect(buildTurnOptions({}).rules).toEqual([]);
    expect(buildTurnOptions({ retryHint: "这次写得更短" }).retry_hint).toBe("这次写得更短");
  });
});

describe("对 AI 隐藏开关", () => {
  it("点击切换并调用后端", async () => {
    render(<AiHiddenToggle kind="character" id={3} hidden={false} />);
    fireEvent.click(screen.getByLabelText("对 AI 隐藏"));
    await waitFor(() => expect(api.cardSetAiHidden).toHaveBeenCalledWith("character", 3, true));
    expect(await screen.findByLabelText("已对 AI 隐藏（点击恢复）")).toBeInTheDocument();
  });
});
