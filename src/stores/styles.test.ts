import { beforeEach, describe, expect, it, vi } from "vitest";

// 可变的后端假数据：save/delete/activate 会改它，list/load 从它读
const db = vi.hoisted(() => ({
  styles: [] as Array<{
    id: number; name: string; prompt_md: string; sample_md: string; tags: string;
    created_at: string; updated_at: string;
  }>,
  active: 0 as number | null,
  bookId: 1 as number | null,
}));

vi.mock("./workspace", () => ({
  useWorkspace: { getState: () => ({ currentBookId: db.bookId }) },
}));

vi.mock("../lib/tauri", () => ({
  api: {
    listStyles: vi.fn(async () => db.styles),
    saveStyle: vi.fn(async (id: number, name: string, promptMd: string, sampleMd: string, tags: string) => {
      if (id === 0) {
        const card = {
          id: Math.max(0, ...db.styles.map((s) => s.id)) + 1,
          name, prompt_md: promptMd, sample_md: sampleMd, tags, created_at: "", updated_at: "",
        };
        db.styles = [...db.styles, card];
        return card;
      }
      const card = db.styles.find((s) => s.id === id)!;
      Object.assign(card, { name, prompt_md: promptMd, sample_md: sampleMd, tags });
      return card;
    }),
    deleteStyle: vi.fn(async (id: number) => { db.styles = db.styles.filter((s) => s.id !== id); }),
    setActiveStyle: vi.fn(async (_bookId: number, styleId: number) => { db.active = styleId; }),
    getActiveStyle: vi.fn(async () => db.active),
  },
}));

import { api, StyleCard } from "../lib/tauri";
import { parseTags, toTagsJson, useStyles } from "./styles";

const card = (id: number, name: string, tags = "[]"): StyleCard =>
  ({ id, name, prompt_md: `指令${id}`, sample_md: `样章${id}`, tags, created_at: "", updated_at: "" });

describe("styles store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.styles = [card(1, "冷峻仙侠", '["仙侠","冷峻"]'), card(2, "轻快日常")];
    db.active = 2;
    db.bookId = 1;
    useStyles.setState({ styles: [], activeStyleId: 0, editingId: null, error: null });
  });

  it("load 填充文风列表并读取当前书的激活文风", async () => {
    await useStyles.getState().load();
    expect(useStyles.getState().styles).toHaveLength(2);
    expect(api.getActiveStyle).toHaveBeenCalledWith(1);
    expect(useStyles.getState().activeStyleId).toBe(2);
    expect(useStyles.getState().error).toBeNull();
  });

  it("save 保存后 reload，并停在保存条目的编辑态", async () => {
    await useStyles.getState().load();
    expect(api.listStyles).toHaveBeenCalledTimes(1);
    const saved = await useStyles.getState().save(0, "新文风", "指令", "样章", '["标签"]');
    expect(api.saveStyle).toHaveBeenCalledWith(0, "新文风", "指令", "样章", '["标签"]');
    expect(api.listStyles).toHaveBeenCalledTimes(2); // save 后 reload 被调
    expect(saved.id).toBe(3);
    expect(useStyles.getState().editingId).toBe(3);
    expect(useStyles.getState().styles).toHaveLength(3);
  });

  it("activate 带上当前书 id 调后端并更新激活态", async () => {
    await useStyles.getState().load();
    await useStyles.getState().activate(1);
    expect(api.setActiveStyle).toHaveBeenCalledWith(1, 1);
    expect(useStyles.getState().activeStyleId).toBe(1);
  });

  it("activate(0) 即「无文风」，同样写后端", async () => {
    await useStyles.getState().load();
    await useStyles.getState().activate(0);
    expect(api.setActiveStyle).toHaveBeenCalledWith(1, 0);
    expect(useStyles.getState().activeStyleId).toBe(0);
  });

  it("无当前书时 activate 不可用：不调后端", async () => {
    db.bookId = null;
    await useStyles.getState().load();
    await useStyles.getState().activate(2);
    expect(api.getActiveStyle).not.toHaveBeenCalled();
    expect(api.setActiveStyle).not.toHaveBeenCalled();
    expect(useStyles.getState().activeStyleId).toBe(0);
  });

  it("remove 删除后 reload；删掉激活项则回落为无文风", async () => {
    await useStyles.getState().load();
    await useStyles.getState().remove(2);
    expect(api.deleteStyle).toHaveBeenCalledWith(2);
    expect(api.listStyles).toHaveBeenCalledTimes(2);
    expect(useStyles.getState().styles).toHaveLength(1);
    expect(useStyles.getState().activeStyleId).toBe(0);
  });

  it("setEditing 切换编辑目标", () => {
    useStyles.getState().setEditing(2);
    expect(useStyles.getState().editingId).toBe(2);
    useStyles.getState().setEditing(null);
    expect(useStyles.getState().editingId).toBeNull();
  });
});

describe("标签编解码", () => {
  it("parseTags 解析 JSON 数组，脏数据回落为空数组", () => {
    expect(parseTags('["仙侠","冷峻"]')).toEqual(["仙侠", "冷峻"]);
    expect(parseTags("[]")).toEqual([]);
    expect(parseTags("")).toEqual([]);
    expect(parseTags("仙侠,冷峻")).toEqual([]); // 非 JSON
    expect(parseTags('{"a":1}')).toEqual([]); // 非数组
  });

  it("toTagsJson 中英文逗号分隔、去空白去空段", () => {
    expect(toTagsJson("仙侠, 冷峻，日常")).toBe('["仙侠","冷峻","日常"]');
    expect(toTagsJson("  ")).toBe("[]");
    expect(parseTags(toTagsJson("仙侠, 冷峻"))).toEqual(["仙侠", "冷峻"]); // 往返
  });
});
