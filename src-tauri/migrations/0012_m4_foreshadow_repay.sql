-- M4 T5 伏笔还债登记（A2 Override 合约）：放行需登记还债章与理由
ALTER TABLE foreshadows ADD COLUMN override_note TEXT NOT NULL DEFAULT '';
ALTER TABLE foreshadows ADD COLUMN repay_chapter_id INTEGER;
