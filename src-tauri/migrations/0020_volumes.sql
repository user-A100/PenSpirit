-- 阶段 3B：卷层级（Scrivener「文件夹即文件」）。
-- 卷 = chapters 里 kind='folder' 的行：磁盘上是 {book}/manuscript/ 下的一层子目录，file_path 指向该目录，
-- 卷首语（可无）存目录内 _index.md。章的 parent_id 指向所属卷（NULL = 顶层）；只有一层（卷 → 章）。
-- sort_key 为全书先序位置；卷与章共用一条全书文件序号，按文件名排序即得全书顺序（rescan 可重建）。
-- 旧数据零改动：全部为顶层正文章。
ALTER TABLE chapters ADD COLUMN kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'folder'));
ALTER TABLE chapters ADD COLUMN parent_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL;
CREATE INDEX idx_chapters_parent ON chapters(book_id, parent_id);
