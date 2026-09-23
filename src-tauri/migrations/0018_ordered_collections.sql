-- Existing manual collections keep the order users saw before this migration.
ALTER TABLE collection_chapters ADD COLUMN position INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT cc.collection_id, cc.chapter_id,
         ROW_NUMBER() OVER (
           PARTITION BY cc.collection_id ORDER BY c.sort_key, c.id
         ) - 1 AS new_position
  FROM collection_chapters cc
  JOIN chapters c ON c.id = cc.chapter_id
)
UPDATE collection_chapters
SET position = (
  SELECT new_position FROM ranked
  WHERE ranked.collection_id = collection_chapters.collection_id
    AND ranked.chapter_id = collection_chapters.chapter_id
);

CREATE INDEX idx_collection_chapters_position
  ON collection_chapters (collection_id, position, chapter_id);
