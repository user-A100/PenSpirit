import { describe, expect, it } from "vitest";
import { fuzzyMatch, initials } from "./pinyin";

describe("拼音首字母", () => {
  it("常见汉字与混排", () => {
    expect(initials("林晚")).toBe("lw");
    expect(initials("第二章 旧城灯火")).toBe("dezjcdh");
    expect(initials("第2章")).toBe("d2z");
    expect(initials("续写")).toBe("xx");
    expect(initials("头脑风暴")).toBe("tnfb");
  });
  it("边界附近的同音字（他/它、润/日、仨/撒）", () => {
    const sample = "他它她塌润日如若然仨撒色三阿八擦搭鹅发嘎哈鸡卡拉妈那哦趴七挖西鸭杂左做钻";
    expect(initials(sample)).toBe("ttttrrrrrssss" + "abcdefghjklmnopqwxy" + "zzzz");
  });
});

describe("fuzzyMatch", () => {
  it("子串优先于首字母，首字母优先于子序列；前缀更高", () => {
    const sub = fuzzyMatch("旧城", "第二章 旧城灯火")!;
    const ini = fuzzyMatch("jc", "第二章 旧城灯火")!;
    const seq = fuzzyMatch("二火", "第二章 旧城灯火")!;
    expect(sub.score).toBeGreaterThan(ini.score);
    expect(ini.score).toBeGreaterThan(seq.score);
    expect(sub.range).toEqual([4, 6]);
    expect(fuzzyMatch("第二", "第二章")!.score).toBeGreaterThan(fuzzyMatch("二章", "第二章")!.score);
  });
  it("不匹配返回 null；空查询统一低分", () => {
    expect(fuzzyMatch("xyz", "第二章")).toBeNull();
    expect(fuzzyMatch("  ", "任意")!.score).toBe(1);
  });
});
