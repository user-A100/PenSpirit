import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/tauri", () => ({
  api: {
    settingGet: vi.fn().mockResolvedValue(null),
    settingSet: vi.fn().mockResolvedValue(undefined),
    listProviders: vi.fn().mockResolvedValue([{ id: 3, name: "深度", model: "deep-v4", base_url: "", api_key: "", max_tokens: 1, temperature: 0.7 }]),
    listMessages: vi.fn().mockResolvedValue([]),
  },
}));

import { api } from "../../lib/tauri";
import { blankPrompt, fillTemplate, templateVars, toSlash, usePrompts, type PromptTemplate } from "../../lib/ai/prompts";
import { findCommand, matchCommands, SLASH_COMMANDS } from "../../lib/ai/slashCommands";
import { runSelectionCommand } from "../../lib/ai/actions";
import { registerEditorBridge, type EditorBridge } from "../../lib/editorBridge";
import { useChat } from "../../stores/chat";
import { useWorkspace } from "../../stores/workspace";
import { VarsDialog } from "./VarsDialog";
import { PromptLibrary } from "./PromptLibrary";
import { ConfirmHost } from "../ui/ConfirmHost";

const tpl = (over: Partial<PromptTemplate>): PromptTemplate => ({ ...blankPrompt(), id: "x1", name: "加强冲突", template: "把{{选区}}改得冲突更尖锐，让{{人物}}主动挑衅。", ...over });

let unregister: (() => void) | null = null;
beforeEach(() => {
  vi.clearAllMocks();
  usePrompts.setState({ list: [], loaded: true });
});
afterEach(() => {
  unregister?.();
  unregister = null;
});

describe("命令库 · 模板与变量（阶段 2B）", () => {
  it("变量去重保序；填充时缺的填空", () => {
    expect(templateVars("{{选区}}与{{ 人物 }}，再说{{选区}}")).toEqual(["选区", "人物"]);
    expect(fillTemplate("把{{选区}}给{{人物}}看{{无}}", { 选区: "这段", 人物: "林晚" })).toBe("把这段给林晚看");
  });

  it("自定义命令并进斜杠菜单：可按名字 / 拼音首字母找到；带 {{选区}} 视为作用于选区、不重复注入选中段落", () => {
    usePrompts.setState({ list: [tpl({ output: "replace", temperature: 1.1, providerId: 3 })] });
    const c = findCommand("custom:x1")!;
    expect(c).toMatchObject({ name: "加强冲突", custom: true, needsSelection: true, output: "replace", temperature: 1.1, providerId: 3, disable: ["选中段落"] });
    expect(matchCommands("jqct")[0].id).toBe("custom:x1");
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length + 1);
    // 名字或模板为空的不进菜单
    usePrompts.setState({ list: [tpl({ name: "" })] });
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length);
    expect(toSlash(tpl({ template: "写一段雪景", output: "insert" })).needsSelection).toBe(false);
  });
});

describe("命令库 · 运行（阶段 2B）", () => {
  function bridge(): EditorBridge {
    return {
      chapterId: 11,
      getContext: () => ({ chapterId: 11, before: "前文", after: "", selection: "她没有回头。", from: 1, to: 7 }),
      insertAtCursor: () => true,
      append: () => true,
      replaceRange: () => true,
      undo: () => {},
      focus: () => {},
    };
  }

  it("气泡里点自定义命令：自动填选区、弹表单问其它变量，带绑定的温度与模型发出", async () => {
    unregister = registerEditorBridge("a", bridge());
    useWorkspace.setState({ activePane: "a", currentChapterId: 11, chapters: [] });
    const send = vi.fn(async () => true);
    useChat.setState({ chapterId: 11, sessionId: 7, streaming: false, quote: null, send });
    usePrompts.setState({ list: [tpl({ output: "replace", temperature: 1.1, providerId: 3, sendNow: true, inBubble: true })] });
    render(<VarsDialog />);
    const run = runSelectionCommand("custom:x1");
    const input = await screen.findByLabelText("人物");
    fireEvent.change(input, { target: { value: "沈砚" } });
    fireEvent.click(screen.getByText("运行"));
    await run;
    expect(send).toHaveBeenCalledWith("把她没有回头。改得冲突更尖锐，让沈砚主动挑衅。", {
      command: "custom:x1",
      mode: "write",
      targetChars: null,
      disable: ["选中段落"],
      temperature: 1.1,
      providerId: 3,
    });
  });

  it("没标「选中即发」：填好后放进输入框；变量表单取消则什么都不做", async () => {
    unregister = registerEditorBridge("a", bridge());
    const send = vi.fn(async () => true);
    const requestCompose = vi.fn();
    useChat.setState({ chapterId: 11, sessionId: 7, streaming: false, quote: null, send, requestCompose });
    usePrompts.setState({ list: [tpl({ sendNow: false })] });
    render(<VarsDialog />);
    let run = runSelectionCommand("custom:x1");
    fireEvent.change(await screen.findByLabelText("人物"), { target: { value: "林晚" } });
    fireEvent.click(screen.getByText("运行"));
    await run;
    expect(requestCompose).toHaveBeenCalledWith("把她没有回头。改得冲突更尖锐，让林晚主动挑衅。", "custom:x1");
    run = runSelectionCommand("custom:x1");
    await screen.findByLabelText("人物");
    fireEvent.click(screen.getByText("取消"));
    await run;
    expect(requestCompose).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
  });
});

describe("命令库面板（阶段 2B）", () => {
  it("新建：填名字与模板、绑定模型、进气泡 → 存进 settings；与内置命令重名拒绝", async () => {
    render(
      <>
        <PromptLibrary onClose={() => {}} />
        <ConfirmHost />
      </>,
    );
    fireEvent.click(screen.getByText("新建命令"));
    fireEvent.change(screen.getByLabelText("命令名"), { target: { value: "润色" } });
    fireEvent.change(screen.getByLabelText("命令模板"), { target: { value: "随便" } });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() => expect(api.listProviders).toHaveBeenCalled());
    expect(api.settingSet).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("命令名"), { target: { value: "加强冲突" } });
    fireEvent.change(screen.getByLabelText("命令模板"), { target: { value: "把{{选区}}改得冲突更尖锐" } });
    await screen.findByRole("option", { name: "深度 · deep-v4" });
    fireEvent.change(screen.getByLabelText("绑定模型"), { target: { value: "3" } });
    fireEvent.click(screen.getByLabelText("出现在正文选区气泡", { exact: false }));
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() => expect(api.settingSet).toHaveBeenCalled());
    const [key, raw] = vi.mocked(api.settingSet).mock.calls[0];
    expect(key).toBe("ai_prompts");
    expect(JSON.parse(raw)).toEqual([expect.objectContaining({ name: "加强冲突", providerId: 3, inBubble: true, output: "insert" })]);
    expect(await screen.findByText("/加强冲突")).toBeInTheDocument();
  });
});
