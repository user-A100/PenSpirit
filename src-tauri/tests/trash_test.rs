use bixian::commands as cmd;
use bixian::state::AppState;
use bixian::trash;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn file_name_of(rel: &str) -> String {
    rel.rsplit('/').next().unwrap().to_string()
}

#[test]
fn soft_delete_hides_chapter_and_moves_file_to_trash() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::write_chapter_inner(&s, ch.id, "正文内容。").unwrap();

    cmd::delete_chapter_inner(&s, ch.id).unwrap();

    // 原文件消失，进入 {book}/.trash/{原文件名}
    assert!(!s.root.join(&ch.file_path).exists());
    let trash_file = s.root.join(format!("{}/.trash/{}", book.slug, file_name_of(&ch.file_path)));
    assert!(trash_file.exists());
    assert_eq!(
        std::fs::read_to_string(&trash_file).unwrap(),
        "正文内容。",
        "移动而非复制，内容保留"
    );

    // list_chapters 过滤软删章；list_trash 可见且带元数据
    assert!(cmd::list_chapters_inner(&s, book.id).unwrap().is_empty());
    let trashed = trash::list_trash_inner(&s, book.id).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].id, ch.id);
    assert!(trashed[0].deleted_at.is_some());
    assert_eq!(trashed[0].orig_file_path.as_deref(), Some(ch.file_path.as_str()));
}

#[test]
fn trash_lists_newest_first() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    cmd::delete_chapter_inner(&s, c1.id).unwrap();
    cmd::delete_chapter_inner(&s, c2.id).unwrap();
    let trashed = trash::list_trash_inner(&s, book.id).unwrap();
    assert_eq!(trashed.len(), 2);
    assert_eq!(trashed[0].id, c2.id, "后删的在前");
    assert_eq!(trashed[1].id, c1.id);
}

#[test]
fn restore_chapter_returns_file_and_visibility() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();

    trash::restore_chapter_inner(&s, ch.id).unwrap();

    assert!(s.root.join(&ch.file_path).exists(), "文件归位到原路径");
    assert!(!s.root.join(format!("{}/.trash", book.slug)).join(file_name_of(&ch.file_path)).exists());
    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, ch.id);
    assert!(list[0].deleted_at.is_none());
    assert!(trash::list_trash_inner(&s, book.id).unwrap().is_empty());
}

#[test]
fn purge_chapter_deletes_file_and_row() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();

    trash::purge_chapter_inner(&s, ch.id).unwrap();

    let trash_dir = s.root.join(format!("{}/.trash", book.slug));
    assert!(std::fs::read_dir(&trash_dir).unwrap().count() == 0, ".trash 内文件已物理删除");
    assert!(trash::list_trash_inner(&s, book.id).unwrap().is_empty());
    assert!(cmd::read_chapter_inner(&s, ch.id).is_err(), "行已删除");
}

#[test]
fn empty_trash_purges_all_soft_deleted() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    let keep = cmd::create_chapter_inner(&s, book.id, "三").unwrap();
    cmd::delete_chapter_inner(&s, c1.id).unwrap();
    cmd::delete_chapter_inner(&s, c2.id).unwrap();

    trash::empty_trash_inner(&s, book.id).unwrap();

    assert!(trash::list_trash_inner(&s, book.id).unwrap().is_empty());
    assert!(std::fs::read_dir(s.root.join(format!("{}/.trash", book.slug))).unwrap().count() == 0);
    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1, "未删除的章不受影响");
    assert_eq!(list[0].id, keep.id);
}

#[test]
fn trash_name_conflict_appends_suffix() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();
    trash::restore_chapter_inner(&s, ch.id).unwrap();
    // 手动在 .trash 放一个同名文件制造冲突
    let occupied = s.root.join(format!("{}/.trash/{}", book.slug, file_name_of(&ch.file_path)));
    std::fs::create_dir_all(occupied.parent().unwrap()).unwrap();
    std::fs::write(&occupied, "旧文件").unwrap();

    cmd::delete_chapter_inner(&s, ch.id).unwrap();

    assert!(occupied.exists(), "已占用名保持不动");
    let stem = {
        let n = file_name_of(&ch.file_path);
        n.strip_suffix(".md").unwrap().to_string()
    };
    let suffixed = s.root.join(format!("{}/.trash/{}-2.md", book.slug, stem));
    assert!(suffixed.exists(), "新软删文件加 -2 后缀: {}", suffixed.display());
    let trashed = trash::list_trash_inner(&s, book.id).unwrap();
    assert_eq!(trashed.len(), 1);
    assert!(trashed[0].file_path.ends_with("-2.md"));
}

// ---- 书级回收站 ----

#[test]
fn soft_delete_book_moves_dir_and_hides() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_book_inner(&s, book.id).unwrap();

    assert!(!s.root.join(&book.slug).exists(), "原目录已移走");
    let trashed_dir = s.root.join(format!(".trash_books/{}", book.slug));
    assert!(trashed_dir.join("manuscript").join(file_name_of(&ch.file_path)).exists(), "整书目录在 .trash_books 下");

    assert!(cmd::list_books_inner(&s).unwrap().is_empty());
    let trashed = trash::list_trash_books_inner(&s).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].id, book.id);
    assert!(trashed[0].deleted_at.is_some());
    assert_eq!(trashed[0].orig_dir_name.as_deref(), Some(book.slug.as_str()));
}

#[test]
fn restore_book_returns_dir_and_chapters() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::write_chapter_inner(&s, ch.id, "内容。").unwrap();
    cmd::delete_book_inner(&s, book.id).unwrap();

    trash::restore_book_inner(&s, book.id).unwrap();

    assert!(s.root.join(&ch.file_path).exists(), "章节文件随目录归位");
    let books = cmd::list_books_inner(&s).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].id, book.id);
    assert_eq!(books[0].slug, book.slug);
    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(cmd::read_chapter_inner(&s, ch.id).unwrap().content, "内容。");
    assert!(trash::list_trash_books_inner(&s).unwrap().is_empty());
}

#[test]
fn restore_book_conflict_uses_new_dir_and_rebases_chapter_paths() {
    let (_tmp, s) = setup();
    let old = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, old.id, "一").unwrap();
    cmd::write_chapter_inner(&s, ch.id, "旧书内容。").unwrap();
    cmd::delete_book_inner(&s, old.id).unwrap();

    // 删后新建同名书，占住原目录名
    let new_book = cmd::create_book_inner(&s, "书").unwrap();
    assert_eq!(new_book.slug, "书");

    trash::restore_book_inner(&s, old.id).unwrap();

    assert!(s.root.join("书").exists(), "新书目录不动");
    assert!(s.root.join("书-2").exists(), "旧书恢复到 -2 目录");
    let books = cmd::list_books_inner(&s).unwrap();
    assert_eq!(books.len(), 2);
    let restored = books.iter().find(|b| b.id == old.id).unwrap();
    assert_eq!(restored.slug, "书-2");
    let list = cmd::list_chapters_inner(&s, old.id).unwrap();
    assert_eq!(list.len(), 1);
    assert!(list[0].file_path.starts_with("书-2/"), "章节路径前缀已重写: {}", list[0].file_path);
    assert_eq!(
        cmd::read_chapter_inner(&s, ch.id).unwrap().content,
        "旧书内容。",
        "重写后的路径可读"
    );
}

#[test]
fn purge_book_removes_dir_and_cascades_chapters() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_book_inner(&s, book.id).unwrap();

    trash::purge_book_inner(&s, book.id).unwrap();

    assert!(!s.root.join(".trash_books").join(&book.slug).exists(), "目录已物理删除");
    assert!(trash::list_trash_books_inner(&s).unwrap().is_empty());
    assert!(cmd::read_chapter_inner(&s, ch.id).is_err(), "章节行随书级联删除");
    let _ = ch;
}

#[test]
fn book_restore_keeps_inner_soft_deleted_chapter() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    cmd::delete_chapter_inner(&s, c1.id).unwrap();
    cmd::delete_book_inner(&s, book.id).unwrap();

    trash::restore_book_inner(&s, book.id).unwrap();

    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, c2.id, "软删章不因书恢复而复活");
    let trashed = trash::list_trash_inner(&s, book.id).unwrap();
    assert_eq!(trashed.len(), 1);
    assert_eq!(trashed[0].id, c1.id);
    assert!(s.root.join(format!("{}/.trash/{}", book.slug, file_name_of(&c1.file_path))).exists());
    // 书恢复后内层软删章仍可继续恢复
    trash::restore_chapter_inner(&s, c1.id).unwrap();
    assert!(s.root.join(&c1.file_path).exists());
}

// ---- rescan 与回收站互斥 ----

#[test]
fn rescan_does_not_revive_soft_deleted_or_scan_trash_dirs() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();

    let n = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n, 0, "软删章的 .trash 文件不被扫描");
    assert!(cmd::list_chapters_inner(&s, book.id).unwrap().is_empty(), "软删行不复活");
    assert_eq!(trash::list_trash_inner(&s, book.id).unwrap().len(), 1, "不产生重复行");

    // 书级：目录在 .trash_books 下，rescan 不得把它当新书
    cmd::delete_book_inner(&s, book.id).unwrap();
    let n2 = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n2, 0);
    assert!(cmd::list_books_inner(&s).unwrap().is_empty(), ".trash_books 不被扫描为书");
    assert_eq!(trash::list_trash_books_inner(&s).unwrap().len(), 1, "回收站中的书保持");
}
