import { describe, expect, it } from "vitest";
import { matchCommands, SLASH_COMMANDS } from "./slashCommands";

describe("斜杠命令", () => {
  it("id 唯一；需选区的命令默认替换", () => {
    expect(new Set(SLASH_COMMANDS.map((c) => c.id)).size).toBe(SLASH_COMMANDS.length);
    for (const c of SLASH_COMMANDS.filter((x) => x.needsSelection)) expect(c.output).toBe("replace");
  });
  it("拼音首字母与中文都能命中，前缀优先", () => {
    expect(matchCommands("xx")[0].id).toBe("continue");
    expect(matchCommands("rs")[0].id).toBe("polish");
    expect(matchCommands("扩")[0].id).toBe("expand");
    expect(matchCommands("tn")[0].id).toBe("brainstorm");
    expect(matchCommands("zj")[0].id).toBe("summary");
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length);
    expect(matchCommands("qqqq")).toHaveLength(0);
  });
});
