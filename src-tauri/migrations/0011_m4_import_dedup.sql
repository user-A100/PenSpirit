-- M4 T4 导入查重：章内容 MD5（导入时写入；同书预览时比对）
ALTER TABLE chapters ADD COLUMN content_hash TEXT;
CREATE INDEX idx_chapters_book_hash ON chapters(book_id, content_hash);
