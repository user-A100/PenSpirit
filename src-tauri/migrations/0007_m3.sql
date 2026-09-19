-- M3：完本目标 + 伏笔登记
ALTER TABLE books ADD COLUMN target_words INTEGER;
CREATE TABLE foreshadows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  planted_chapter_id INTEGER NOT NULL,   -- 埋设章（chapters.id，序号由前端按列表序解析）
  target_chapter_id INTEGER,             -- 计划回收章（NULL=未定）
  status TEXT NOT NULL DEFAULT 'active', -- active | resolved | dropped
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  resolved_chapter_id INTEGER
);
