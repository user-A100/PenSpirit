-- 阶段 2B 上下文控制（只加列 / 加表）：
--   设定卡「对 AI 隐藏」（防剧透：注入时跳过；@ 主动引用仍可带上）；
--   人物「仅作者可见」笔记（真实身份等，永不发给 AI）；
--   写作规则：always = 全书常驻；scoped = 只在指定章 / 卷生效；manual = 本轮手动选用。
ALTER TABLE characters ADD COLUMN ai_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE characters ADD COLUMN secret_note TEXT NOT NULL DEFAULT '';
ALTER TABLE foreshadows ADD COLUMN ai_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plot_blocks ADD COLUMN ai_hidden INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outlines ADD COLUMN ai_hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE writing_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'always' CHECK (mode IN ('always', 'scoped', 'manual')),
  scope_ids TEXT NOT NULL DEFAULT '[]',
  sort_key INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_writing_rules_book ON writing_rules(book_id);
