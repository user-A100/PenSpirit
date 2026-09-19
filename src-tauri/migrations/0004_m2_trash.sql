-- M2-T6: 回收站软删除标记
-- 章：deleted_at = 软删时间；orig_file_path = 删除前相对路径（file_path 此时指向 {book}/.trash/ 内位置）
-- 书：deleted_at = 软删时间；orig_dir_name = 删除前目录名（slug 此时指向 .trash_books/ 内位置）
ALTER TABLE chapters ADD COLUMN deleted_at TEXT;
ALTER TABLE chapters ADD COLUMN orig_file_path TEXT;
ALTER TABLE books ADD COLUMN deleted_at TEXT;
ALTER TABLE books ADD COLUMN orig_dir_name TEXT;
