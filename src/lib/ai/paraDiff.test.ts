import { describe, expect, it } from "vitest";
import { applyHunks, newParagraphs, paragraphHunks, similarity } from "./paraDiff";

describe("段落级差异（阶段 2B）", () => {
  it("相同段落不成改动块；全同 → 无改动", () => {
    expect(paragraphHunks("甲。\n乙。", "甲。\n乙。")).toEqual([
      { kind: "same", text: "甲。" },
      { kind: "same", text: "乙。" },
    ]);
  });

  it("每段都润色过：仍按段一一对齐，而不是并成一个大块", () => {
    const before = "夜雨落在旧城的青石板上，灯笼一盏盏亮起。\n林晚撑着伞，站在桥头等人。\n远处传来更夫的梆子声。";
    const after = "夜雨敲在旧城的青石板上，灯笼一盏接一盏亮起。\n林晚撑伞立在桥头，等一个人。\n远处隐约传来更夫的梆子声。";
    const segs = paragraphHunks(before, after);
    expect(segs).toHaveLength(3);
    expect(segs.every((s) => s.kind === "change" && s.old.length === 1 && s.new.length === 1)).toBe(true);
  });

  it("新增 / 删除段落单独成块；按块取舍拼出最终文本", () => {
    const before = "第一段不变的内容。\n要删掉的旧段落在这里。\n第三段原文的句子。";
    const after = "第一段不变的内容。\n第三段改写后的句子。\n新加的一段完全不同。";
    const segs = paragraphHunks(before, after);
    expect(segs[0]).toEqual({ kind: "same", text: "第一段不变的内容。" });
    const changes = segs.filter((s) => s.kind === "change");
    expect(changes.length).toBeGreaterThanOrEqual(2);
    // 全部采用 = 新文；全部保留 = 原文
    expect(applyHunks(segs, () => true)).toBe(after);
    expect(applyHunks(segs, () => false)).toBe(before);
  });

  it("只采用第一处改动", () => {
    const before = "甲段原文很长的一个句子。\n乙段原文不变。\n丙段原文也是很长的句子。";
    const after = "甲段新文很长的一个句子。\n乙段原文不变。\n丙段新文也是很长的句子。";
    const segs = paragraphHunks(before, after);
    expect(applyHunks(segs, (k) => k === 0)).toBe("甲段新文很长的一个句子。\n乙段原文不变。\n丙段原文也是很长的句子。");
  });

  it("相似度：同段改几个字仍高，完全不同的段落低", () => {
    expect(similarity("林晚撑着伞，站在桥头等人。", "林晚撑伞立在桥头，等一个人。")).toBeGreaterThan(0.3);
    expect(similarity("林晚撑着伞，站在桥头等人。", "北境的雪下了三天三夜。")).toBeLessThan(0.3);
  });

  it("newParagraphs：只取新文中不是原文原样的段", () => {
    expect(newParagraphs("甲。\n乙。", "甲。\n乙改了。\n丙。")).toEqual(["乙改了。", "丙。"]);
  });
});
