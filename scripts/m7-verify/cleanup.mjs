// M7 批次5 核验清场：删掉隔离测试书（级联清 chapters）+ 库目录 m7b5/。
// 用法：node scripts/m7-verify/cleanup.mjs（先关掉 app，避免连接占用）
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";

const db = new DatabaseSync(join(process.env.APPDATA, "com.bixian.app", "bixian.db"));
db.exec("PRAGMA foreign_keys = ON");

const book = db.prepare("SELECT id FROM books WHERE slug = 'm7b5'").get();
if (book) {
  db.prepare("DELETE FROM books WHERE id = ?").run(book.id);
  console.log(`已删除测试书 #${book.id}`);
} else {
  console.log("无残留测试书");
}
rmSync(join(process.env.APPDATA, "com.bixian.app", "library", "m7b5"), {
  recursive: true,
  force: true,
});
rmSync(join(import.meta.dirname, "orig.json"), { force: true });
console.log("剩余书籍:", JSON.stringify(db.prepare("SELECT id, title FROM books").all()));
