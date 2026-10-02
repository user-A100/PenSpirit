-- 阶段 2C：回答评分（1 = 👍，-1 = 👎，0 = 未评），用于本地提示词调优（按命令统计）。只加列。
ALTER TABLE messages ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
