// M7 批次7 核验清理：删隔离测试书 m7b7（级联清章节/自定义字段定义/字段值）。
// 用法：node scripts/m7b7-verify/cleanup.mjs
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";

const APPDATA = process.env.APPDATA;
const DB = join(APPDATA, "com.bixian.app", "bixian.db");
const LIB = join(APPDATA, "com.bixian.app", "library");

const db = new DatabaseSync(DB);
db.exec("PRAGMA foreign_keys = ON");

const slug = "m7b7";
const row = db.prepare("SELECT id FROM books WHERE slug = ?").get(slug);
if (row) {
  db.prepare("DELETE FROM books WHERE id = ?").run(row.id);
  console.log(`已删除测试书 ${slug}（id=${row.id}）及级联数据`);
} else {
  console.log("没有需要清理的测试书");
}

rmSync(join(LIB, slug), { recursive: true, force: true });
