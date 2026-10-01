import { describe, expect, it } from "vitest";
import { errCode, errMsg } from "./errors";

describe("errMsg", () => {
  it("AppError invalid 只取 message", () => {
    expect(errMsg({ code: "invalid", message: "未配置可用的 AI 服务商" })).toBe("未配置可用的 AI 服务商");
  });
  it("AppError 其余码加中文前缀", () => {
    expect(errMsg({ code: "db", message: "UNIQUE constraint failed" })).toBe("数据库错误：UNIQUE constraint failed");
    expect(errMsg({ code: "lock_poisoned" })).toBe("数据库锁中毒，请重启应用");
  });
  it("字符串 / Error / 未知对象", () => {
    expect(errMsg("磁盘满")).toBe("磁盘满");
    expect(errMsg(new Error("网络错误"))).toBe("网络错误");
    expect(errMsg({ foo: 1 })).toBe('{"foo":1}');
    expect(errMsg(null)).toBe("未知错误");
  });
  it("永不出现 [object Object]", () => {
    for (const e of [{}, { code: "x" }, { message: {} }, Object.create(null)]) {
      expect(errMsg(e)).not.toContain("[object Object]");
    }
  });
  it("errCode", () => {
    expect(errCode({ code: "invalid", message: "x" })).toBe("invalid");
    expect(errCode(new Error("x"))).toBeNull();
  });
});
