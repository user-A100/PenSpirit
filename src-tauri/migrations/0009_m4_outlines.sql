-- M4 大纲体系（webnovel-writer 4 级大纲裁剪为 3 级，适配 SQLite 落地）：
-- master=总纲（每书一篇）/ volume=卷纲（手动分卷，sort_key 排序）/
-- chapter=章细纲（chapter_id 关联，每章一篇）
CREATE TABLE outlines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('master','volume','chapter')),
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE CASCADE, -- kind=chapter 必填，其余 NULL
  title TEXT NOT NULL DEFAULT '',   -- 卷纲的卷名；master/chapter 通常留空
  content TEXT NOT NULL DEFAULT '',
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_outlines_book ON outlines(book_id, kind);
