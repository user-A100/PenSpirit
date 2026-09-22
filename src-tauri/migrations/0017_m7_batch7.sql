-- M7 批次7：自定义元数据字段 + 自由卡片墙摆位。
-- 自定义字段：书级定义（text/checkbox/list/date 四型），章节值以 def_id→JSON 值
-- 存 chapters.custom_meta（JSON），删定义不清洗孤儿键（下次整卡保存自然收敛）。
-- 自由卡片墙：freeform_x/y 存每章画布坐标，与 sort_key 解耦，手动 Commit 才回写顺序。
CREATE TABLE custom_field_defs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  list_options TEXT NOT NULL DEFAULT '[]',
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(book_id, name)
);

ALTER TABLE chapters ADD COLUMN custom_meta TEXT NOT NULL DEFAULT '{}';
ALTER TABLE chapters ADD COLUMN freeform_x REAL NOT NULL DEFAULT 0;
ALTER TABLE chapters ADD COLUMN freeform_y REAL NOT NULL DEFAULT 0;
