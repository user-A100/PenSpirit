-- M4 素材库 + 情节块：
-- materials 全局（不分书）——素材是作者资产，跨书复用；
-- plot_blocks 按书——情节块是叙事草稿材料，随书生灭。
CREATE TABLE materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,             -- 素材名（必填）
  category TEXT NOT NULL DEFAULT '',-- 分类（如：地名/门派/道具/金句）
  content TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '',    -- 逗号分隔标签（检索用）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_materials_category ON materials(category);

CREATE TABLE plot_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  content TEXT NOT NULL,            -- 情节/场景描述（一句话到一段）
  status TEXT NOT NULL DEFAULT 'idea', -- idea=点子 | ready=可写 | used=已用
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL, -- 用在哪章（软删保留，物理删置空）
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_plot_blocks_book ON plot_blocks(book_id, status);
