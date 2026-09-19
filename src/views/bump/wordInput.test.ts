import { describe, expect, it } from "vitest";
import { parseWords } from "./wordInput";

// M3-T8 批量加词的切分规则：空格/中西标点均认，去重保序，超长丢弃。

describe("parseWords", () => {
  it("按空格（含连续/首尾空格）切分", () => {
    expect(parseWords("雨夜 邮差 菜刀")).toEqual(["雨夜", "邮差", "菜刀"]);
    expect(parseWords("  雨夜   邮差 ")).toEqual(["雨夜", "邮差"]);
  });

  it("按中文标点（，、；。）切分", () => {
    expect(parseWords("雨夜，邮差、菜刀；铁锅。灯塔")).toEqual(["雨夜", "邮差", "菜刀", "铁锅", "灯塔"]);
  });

  it("混合中英文标点切分（, ; . ! ？ · • | / \\）", () => {
    expect(parseWords("雨夜,邮差;菜刀!铁锅？灯塔·船票•月亮|大雾/码头\\灯塔2")).toEqual([
      "雨夜", "邮差", "菜刀", "铁锅", "灯塔", "船票", "月亮", "大雾", "码头", "灯塔2",
    ]);
    expect(parseWords("雨夜,，、邮差")).toEqual(["雨夜", "邮差"]);
  });

  it("去重保序", () => {
    expect(parseWords("雨夜 邮差 雨夜 菜刀 邮差")).toEqual(["雨夜", "邮差", "菜刀"]);
  });

  it("丢弃超长词（>16 字符），16 字符保留", () => {
    const sixteen = "长".repeat(16);
    const seventeen = "长".repeat(17);
    expect(parseWords(sixteen)).toEqual([sixteen]);
    expect(parseWords(seventeen)).toEqual([]);
    expect(parseWords(`短词 ${seventeen} 尾词`)).toEqual(["短词", "尾词"]);
  });

  it("无分隔符的单词输入原样返回", () => {
    expect(parseWords("雨夜")).toEqual(["雨夜"]);
    expect(parseWords("foghorne")).toEqual(["foghorne"]);
  });

  it("空串或全分隔符返回空数组", () => {
    expect(parseWords("")).toEqual([]);
    expect(parseWords("  ，，、；。。！？·||/\\  ")).toEqual([]);
  });
});
