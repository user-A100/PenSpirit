use bixian::commands as cmd;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

#[test]
fn book_chapter_full_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "红楼梦").unwrap();
    assert_eq!(book.slug, "红楼梦");
    let ch = cmd::create_chapter_inner(&s, book.id, "初见").unwrap();
    assert!(ch.file_path.ends_with("0001-初见.md"));
    let meta = cmd::write_chapter_inner(&s, ch.id, "黛玉进了贾府，见了宝玉。").unwrap();
    assert_eq!(meta.word_count, 10); // 10 个 CJK 字（黛玉进了贾府见了宝玉），标点不计
    let back = cmd::read_chapter_inner(&s, ch.id).unwrap();
    assert_eq!(back.content, "黛玉进了贾府，见了宝玉。");
    assert_eq!(back.meta.id, ch.id);
}

#[test]
fn rename_moves_file() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一章").unwrap();
    let old_abs = s.root.join(&ch.file_path);
    assert!(old_abs.exists());
    let renamed = cmd::rename_chapter_inner(&s, ch.id, "新章").unwrap();
    assert!(!old_abs.exists());
    assert!(s.root.join(&renamed.file_path).exists());
    let _ = tmp; // 持有到函数结束
}

#[test]
fn delete_chapter_is_soft_delete_to_trash() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::delete_chapter_inner(&s, ch.id).unwrap();
    // M2-T6：删除 = 软删，原文件移入 {book}/.trash/，章节列表过滤
    assert!(!s.root.join(&ch.file_path).exists());
    let file_name = ch.file_path.rsplit('/').next().unwrap();
    assert!(s.root.join(format!("{}/.trash/{}", book.slug, file_name)).exists());
    assert!(cmd::list_chapters_inner(&s, book.id).unwrap().is_empty());
    assert!(cmd::read_chapter_inner(&s, ch.id).is_ok(), "行保留，回收站可读");
}

#[test]
fn invalid_title_rejected() {
    let (_tmp, s) = setup();
    assert!(cmd::create_book_inner(&s, "").is_err());
}
