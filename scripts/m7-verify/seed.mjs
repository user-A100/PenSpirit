// M7 批次5 实机核验种子：建隔离测试书 m7b5 + 三章（一章超长供打字机滚动，两章短文供分屏互证）。
// 用完 cleanup.mjs 清干净（不动用户原有书）。用法：node scripts/m7-verify/seed.mjs
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPDATA = process.env.APPDATA;
const DB = join(APPDATA, "com.bixian.app", "bixian.db");
const LIB = join(APPDATA, "com.bixian.app", "library");

const db = new DatabaseSync(DB);
db.exec("PRAGMA foreign_keys = ON");

const slug = "m7b5";
const stale = db.prepare("SELECT id FROM books WHERE slug = ?").get(slug);
if (stale) {
  db.prepare("DELETE FROM books WHERE id = ?").run(stale.id); // 级联清 chapters
}
const bookId = db
  .prepare("INSERT INTO books (slug, title) VALUES (?, ?) RETURNING id")
  .get(slug, "M7批次5核验").id;

// 长章：120 段，每段自成一行（空行分隔），足够打出多屏滚动
const longParas = Array.from({ length: 120 }, (_, i) =>
  `第${i + 1}段，山风掠过檐角，纸窗上灯影摇晃，远处更声三下，夜雨初歇。`,
);
const chapters = [
  { key: "long", title: "长章", sort: 1, paras: longParas },
  { key: "jia", title: "短章甲", sort: 2, paras: ["山间小径泥泞，独行者裹紧斗篷。", "溪水声近了。"] },
  { key: "yi", title: "短章乙", sort: 3, paras: ["渡口的灯笼次第亮起。", "船家说，今夜不走。"] },
];

const ids = {};
mkdirSync(join(LIB, slug, "manuscript"), { recursive: true });
const ins = db.prepare(
  "INSERT INTO chapters (book_id, file_path, title, sort_key, word_count) VALUES (?, ?, ?, ?, ?) RETURNING id",
);
for (const c of chapters) {
  const rel = `${slug}/manuscript/${String(c.sort).padStart(4, "0")}-${c.key}.md`;
  const content = c.paras.join("\n\n");
  writeFileSync(join(LIB, rel), content, "utf8");
  const wc = content.replace(/[^\p{Script=Han}a-zA-Z0-9]/gu, "").length;
  ids[c.key] = ins.get(bookId, rel, c.title, c.sort, wc).id;
}

console.log(JSON.stringify({ bookId, ...ids }));
writeFileSync(join(import.meta.dirname, "ids.json"), JSON.stringify({ bookId, ...ids }));
