-- M4：人物卡（人物图谱的第一块底座——先落卡片 CRUD，
-- 别名/关系/出场章节等图谱能力在此表之上迭代）
CREATE TABLE characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',        -- 主角/配角/反派…自由文本
  aliases TEXT NOT NULL DEFAULT '',     -- 逗号分隔别名（检索/图谱消歧用）
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
