-- M7 批次4：集合（Scrivener Collections 移植）。
-- kind='manual' 手动集合：章节是引用不是拷贝（章删则自动出列，ON DELETE CASCADE）；
-- kind='saved' 存为搜索：只存 query，结果打开时实时计算，不落 chapter 关联。
CREATE TABLE collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'manual',
  query TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(book_id, name)
);

CREATE TABLE collection_chapters (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (collection_id, chapter_id)
);
