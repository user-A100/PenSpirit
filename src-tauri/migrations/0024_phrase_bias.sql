-- 阶段 2C：词语偏置（AI 腔禁用词表 / 偏好用词）。book_id 为空 = 所有书通用。只加表。
CREATE TABLE phrase_bias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER REFERENCES books(id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'ban' CHECK (kind IN ('ban', 'prefer')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_phrase_bias_unique ON phrase_bias(IFNULL(book_id, 0), phrase, kind);
