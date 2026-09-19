-- M2-T4: ACP 会话来源标记（'provider' = M1 HTTP 直连，'agent:{id}' = ACP agent）
ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'provider';
