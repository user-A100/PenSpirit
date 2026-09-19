-- M2-T10: 碰碰车词库与灵感卡
-- bump_words：灵感碰撞词库（chips 增删）。预置示例词写在这里——迁移只跑一次，
-- 故用户「清空词库」后不会在下次启动时被重新塞回来。
-- ideas：灵感卡（words_json = 碰撞出的词组、tags_json = 标签、content = 备注），M5 素材系统直接复用。
CREATE TABLE bump_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL DEFAULT '',
  words_json TEXT NOT NULL DEFAULT '[]',
  tags_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO bump_words (word) VALUES
  ('蝴蝶'), ('菜刀'), ('铁锅'), ('雨夜'), ('邮差'),
  ('旧照片'), ('停电'), ('末班车'), ('钥匙'), ('镜子');
