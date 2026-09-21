-- M7 批次1：章节元数据层（synopsis/label/status/target + 彩色关键词）
-- synopsis 独立于正文（卡片墙/大纲列展示用，导出不带）；
-- label/status 为书内定义的单选标签（章 → 定义，删定义置 NULL）；
-- keywords 书内多对多（chapter_keywords），UNIQUE(book_id, title) 防重名。
ALTER TABLE chapters ADD COLUMN synopsis TEXT NOT NULL DEFAULT '';
ALTER TABLE chapters ADD COLUMN label_id INTEGER REFERENCES labels(id) ON DELETE SET NULL;
ALTER TABLE chapters ADD COLUMN status_id INTEGER REFERENCES statuses(id) ON DELETE SET NULL;
ALTER TABLE chapters ADD COLUMN target_words INTEGER;

CREATE TABLE labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#60a5fa',
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_labels_book ON labels(book_id);

CREATE TABLE statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_statuses_book ON statuses(book_id);

CREATE TABLE keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#94a3b8',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(book_id, title)
);

CREATE TABLE chapter_keywords (
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  keyword_id INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  PRIMARY KEY (chapter_id, keyword_id)
);

-- 既有书补种子：六状态 + 六色标签（新书的种子在 create_book_inner 里种）
-- 注：SQLite 不支持 (VALUES ...) v(c1,c2) 带列名别名，须用 UNION ALL 子查询取别名
INSERT INTO statuses (book_id, title, sort_key)
SELECT b.id, x.title, x.ord FROM books b, (
  SELECT '待写' AS title, 0 AS ord UNION ALL SELECT '写作中', 1 UNION ALL
  SELECT '初稿', 2 UNION ALL SELECT '修改稿', 3 UNION ALL
  SELECT '定稿', 4 UNION ALL SELECT '已完成', 5
) x;

INSERT INTO labels (book_id, title, color, sort_key)
SELECT b.id, x.title, x.color, x.ord FROM books b, (
  SELECT '红' AS title, '#f87171' AS color, 0 AS ord UNION ALL SELECT '橙', '#fb923c', 1 UNION ALL
  SELECT '黄', '#facc15', 2 UNION ALL SELECT '绿', '#4ade80', 3 UNION ALL
  SELECT '蓝', '#60a5fa', 4 UNION ALL SELECT '紫', '#c084fc', 5
) x;
