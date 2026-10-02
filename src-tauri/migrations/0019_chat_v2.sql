-- 阶段 2A：AI 对话 v2——重新生成保留版本 / 采纳标记 / 回合元信息 / 会话最近使用时间。
-- 全部为增量列，旧数据零改动语义：
--   reply_to：assistant 回答所针对的 user 消息（同一 reply_to 的多条 = 多个版本），删问题级联删回答；
--   active：同组版本中当前选用的那条（历史组装只取 active=1 的回答）；
--   adopted：已采纳进正文（采纳不再删除消息）；
--   meta：JSON（模式 / 斜杠命令 / 截断错误等）。
ALTER TABLE messages ADD COLUMN reply_to INTEGER REFERENCES messages(id) ON DELETE CASCADE;
ALTER TABLE messages ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE messages ADD COLUMN adopted INTEGER NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';

-- 旧回答回填 reply_to：同会话中它之前最近的一条 user 消息
UPDATE messages
SET reply_to = (
  SELECT m2.id FROM messages m2
  WHERE m2.session_id = messages.session_id AND m2.role = 'user' AND m2.id < messages.id
  ORDER BY m2.id DESC LIMIT 1
)
WHERE role = 'assistant';

ALTER TABLE sessions ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE sessions SET updated_at = COALESCE(
  (SELECT MAX(m.created_at) FROM messages m WHERE m.session_id = sessions.id),
  created_at
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
