use bixian::commands as cmd;
use bixian::fs_service as fsx;
use bixian::state::AppState;

#[test]
fn rescan_rebuilds_from_files_and_is_idempotent() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    // 直接在磁盘造文件（模拟用户手动拷入书籍）
    fsx::create_book_dir(&s.root, "shou-cang", "收藏的书").unwrap();
    fsx::write_chapter(&s.root, "shou-cang/manuscript/0001-yi.md", "第一章内容。").unwrap();
    fsx::write_chapter(&s.root, "shou-cang/manuscript/0002-er.md", "第二章。").unwrap();

    let n = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n, 2);
    let books = cmd::list_books_inner(&s).unwrap();
    assert_eq!(books.len(), 1);
    assert_eq!(books[0].title, "收藏的书");
    let chs = cmd::list_chapters_inner(&s, books[0].id).unwrap();
    assert_eq!(chs.len(), 2);
    assert_eq!(chs[0].title, "yi"); // 无 DB 记录时标题取文件名去序号与扩展名
    assert!(chs[0].word_count > 0);

    // 幂等：重跑不重复
    let n2 = cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(n2, 2);
    let books2 = cmd::list_books_inner(&s).unwrap();
    assert_eq!(cmd::list_chapters_inner(&s, books2[0].id).unwrap().len(), 2);
    assert_eq!(books2[0].id, books[0].id); // upsert 保持 id 稳定
}
