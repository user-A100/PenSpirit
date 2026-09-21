-- M7 批次2：章节模板（Scrivener Template Sheets / DefaultChildTemplateUUID 的移植）
-- 每书可有多个模板；is_default=1 的模板在「新建章节」时自动作为初始正文（无文件夹层级，默认模板即文件夹默认子模板的对应物）。
-- 部分唯一索引保证每书至多一个默认模板。
CREATE TABLE chapter_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(book_id, name)
);
CREATE INDEX idx_chapter_templates_book ON chapter_templates(book_id);
CREATE UNIQUE INDEX idx_chapter_templates_default ON chapter_templates(book_id) WHERE is_default = 1;
