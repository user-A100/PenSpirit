// M5 核验清场：删掉隔离测试书（级联清 characters/maps/places/relations）+ 落盘的底图。
// 用法：node scripts/m5-verify/cleanup.mjs（先关掉 app，避免连接占用）
import { DatabaseSync } from "node:sqlite";
import { rmSync } from "node:fs";
import { join } from "node:path";

const db = new DatabaseSync(join(process.env.APPDATA, "com.bixian.app", "bixian.db"));
db.exec("PRAGMA foreign_keys = ON");

const book = db.prepare("SELECT id FROM books WHERE slug = 'm5-verify'").get();
if (book) {
  const paths = db.prepare("SELECT path FROM maps WHERE book_id = ?").all(book.id);
  db.prepare("DELETE FROM books WHERE id = ?").run(book.id);
  for (const { path } of paths) rmSync(path, { force: true });
  console.log(`已删除测试书 #${book.id}，底图 ${paths.length} 个`);
} else {
  console.log("无残留测试书");
}
console.log("剩余书籍:", JSON.stringify(db.prepare("SELECT id, title FROM books").all()));
