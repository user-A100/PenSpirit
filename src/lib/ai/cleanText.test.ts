import { describe, expect, it } from "vitest";
import { cleanAiText, plainText } from "./cleanText";

describe("cleanAiText", () => {
  it("剥开场白与客套结尾", () => {
    const raw = "好的，以下是续写内容：\n\n他推开门，屋里一片漆黑。\n林晚没有回头。\n\n希望这段对你有帮助！";
    expect(cleanAiText(raw)).toBe("他推开门，屋里一片漆黑。\n林晚没有回头。");
  });
  it("去 Markdown 记号与段首全角空格，压缩多余空行", () => {
    const raw = "### 第三幕\n\n\n\n　　**夜雨**初歇，*灯火*摇晃。\n> 远处更声三下。";
    expect(cleanAiText(raw)).toBe("第三幕\n\n夜雨初歇，灯火摇晃。\n远处更声三下。");
  });
  it("剥整体代码块包裹；讨论模式（prose=false）保留 Markdown", () => {
    expect(cleanAiText("```\n正文一段。\n```")).toBe("正文一段。");
    expect(cleanAiText("**建议**：加快节奏", { prose: false })).toBe("**建议**：加快节奏");
  });
  it("不误伤以「好」开头的正文", () => {
    expect(cleanAiText("好一场大雪，压塌了半个山门。")).toBe("好一场大雪，压塌了半个山门。");
  });
});

describe("plainText", () => {
  it("复制时去掉记号保留段落", () => {
    expect(plainText("## 方向\n- **甲**：`冲突`")).toBe("方向\n- 甲：冲突");
  });
});
