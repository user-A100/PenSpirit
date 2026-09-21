// M5 实机核验种子：建隔离测试书 + 角色 + 地图/pin，关系留给 UI 现场建。
// 用完 cleanup.mjs 清干净（不动用户原有书）。用法：node scripts/m5-verify/seed.mjs
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const APPDATA = process.env.APPDATA;
const DB = join(APPDATA, "com.bixian.app", "bixian.db");
const MAPS_DIR = join(APPDATA, "com.bixian.app", "maps");
const SRC_IMG = process.argv[2];
if (!SRC_IMG) throw new Error("用法: node seed.mjs <源图路径>");

const db = new DatabaseSync(DB);
db.exec("PRAGMA foreign_keys = ON");

const slug = "m5-verify";
const stale = db.prepare("SELECT id FROM books WHERE slug = ?").get(slug);
if (stale) {
  db.prepare("DELETE FROM character_relations WHERE book_id = ?").run(stale.id);
  db.prepare("DELETE FROM books WHERE id = ?").run(stale.id); // 级联清 characters/maps/places
}
const bookId = db
  .prepare("INSERT INTO books (slug, title) VALUES (?, ?) RETURNING id")
  .get(slug, "M5核验").id;

const insChar = db.prepare(
  "INSERT INTO characters (book_id, name, role, description) VALUES (?, ?, ?, '') RETURNING id",
);
const ids = {};
for (const [key, name, role] of [
  ["father", "林远山", "主角"],
  ["mother", "苏婉", "配角"],
  ["child", "林小晚", "主角"],
]) {
  ids[key] = insChar.get(bookId, name, role).id;
}

mkdirSync(MAPS_DIR, { recursive: true });
const dest = join(MAPS_DIR, "m5-verify-map.png");
copyFileSync(SRC_IMG, dest);
const mapId = db
  .prepare("INSERT INTO maps (book_id, name, path) VALUES (?, '九州图', ?) RETURNING id")
  .get(bookId, dest).id;
const placeId = db
  .prepare(
    "INSERT INTO places (book_id, map_id, name, description, linked_character_ids, x, y) VALUES (?, ?, '落霞镇', '山坳里的小镇', ?, 30, 40) RETURNING id",
  )
  .get(bookId, mapId, String(ids.child)).id;

console.log(JSON.stringify({ bookId, mapId, placeId, ...ids, mapPath: dest }));
writeFileSync(join(import.meta.dirname, "ids.json"), JSON.stringify({ bookId, mapId, placeId, ...ids }));
