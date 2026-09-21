// M6 实机核验用临时种子：只种可识别的 M6 标记行，用完 cleanup 清干净（不动用户数据）。
// 用法：node scripts/m6-verify/seed.mjs        种
//       node scripts/m6-verify/seed.mjs clean  清
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const db = new DatabaseSync(join(process.env.APPDATA, "com.bixian.app", "bixian.db"));
const MARK = "M6VERIFY";

if (process.argv[2] === "clean") {
  const a = db.prepare("DELETE FROM materials WHERE title LIKE ?").run(MARK + "%");
  const b = db.prepare("DELETE FROM ideas WHERE words_json LIKE ?").run("%" + MARK + "%");
  console.log(`已清理 materials=${a.changes} ideas=${b.changes}`);
  process.exit(0);
}

db.prepare("DELETE FROM materials WHERE title LIKE ?").run(MARK + "%");
db.prepare("DELETE FROM ideas WHERE words_json LIKE ?").run("%" + MARK + "%");

const insM = db.prepare(
  "INSERT INTO materials (title, category, content, tags) VALUES ($title, $category, $content, $tags)",
);
for (const [title, category, content, tags] of [
  [`${MARK} 落霞镇`, "地名", "山坳里的小镇，青石巷尽头有一口枯井。", "地理, 小镇"],
  [`${MARK} 听雪楼`, "门派", "以剑闻名，楼主三十年未出楼一步。", "门派, 武侠"],
  [`${MARK} 断刃诀`, "设定", "以自伤换杀力的剑法，修习者寿数皆短。", "武功, 设定"],
]) {
  insM.run({ title, category, content, tags });
}

const insI = db.prepare(
  "INSERT INTO ideas (content, words_json, tags_json) VALUES ($content, $words, $tags)",
);
for (const [words, content, tags] of [
  [[`${MARK}枯井`, "雨夜", "旧信"], "井底捞出一封未寄出的信", ["悬疑"]],
  [[`${MARK}听雪楼`, "叛徒"], "楼主闭关三十年其实早已身亡", ["反转"]],
  [[`${MARK}断刃诀`, "师徒", "最后一式"], "师父把最后一式藏进了徒弟的名字里", ["情感"]],
]) {
  insI.run({ content, words: JSON.stringify(words), tags: JSON.stringify(tags) });
}

console.log("已种：materials=3 ideas=3");
