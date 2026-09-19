-- M2-T11: 写作统计
-- 差量累加：date 取本地日期（SQL 里 date('now','localtime')），跨 0 点自然落到新行。
-- words 可正可负（删改会减），active_minutes 只增。主键 (date, book_id) 支撑 upsert。
CREATE TABLE writing_stats (
  date TEXT NOT NULL,
  book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  words INTEGER NOT NULL DEFAULT 0,
  active_minutes INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (date, book_id)
);
