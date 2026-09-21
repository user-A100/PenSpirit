-- M5 图谱：角色关系 + 世界地图（家族树/关系网络/地图三视图底座）
CREATE TABLE character_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(source_id, target_id, relation_type)
);
CREATE INDEX idx_relations_book ON character_relations(book_id);

CREATE TABLE maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE places (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  linked_character_ids TEXT NOT NULL DEFAULT '',
  x REAL NOT NULL DEFAULT 50,
  y REAL NOT NULL DEFAULT 50,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_places_map ON places(map_id);
