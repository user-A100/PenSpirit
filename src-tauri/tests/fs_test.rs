use bixian::fs_service as fsx;
use bixian::util::count_words;

#[test]
fn count_words_cjk_and_latin() {
    assert_eq!(count_words("黛玉走进来，说：“好。”"), 7); // 黛玉走进来说好
    assert_eq!(count_words("hello world 123"), 3);
    assert_eq!(count_words("第3章 AI来了"), 6); // 第章来了=4 CJK + "3"+"AI"=2
}

#[test]
fn slugify_rules() {
    assert_eq!(fsx::slugify("红楼梦"), "红楼梦");
    assert_eq!(fsx::slugify("My Book: Vol.1"), "my-book-vol-1");
    assert_eq!(fsx::slugify("///"), "untitled");
}

#[test]
fn chapter_path_format() {
    assert_eq!(fsx::chapter_rel_path("shu", 12, "初见"), "shu/manuscript/0012-初见.md");
}

#[test]
fn book_dir_and_roundtrip_and_scan() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    fsx::create_book_dir(&root, "hongloumeng", "红楼梦").unwrap();
    let rel = fsx::chapter_rel_path("hongloumeng", 1, "初见");
    fsx::write_chapter(&root, &rel, "黛玉进了贾府。").unwrap();
    assert_eq!(fsx::read_chapter(&root, &rel).unwrap(), "黛玉进了贾府。");
    let scanned = fsx::scan_library(&root).unwrap();
    assert_eq!(scanned.len(), 1);
    assert_eq!(scanned[0].title, "红楼梦");
    assert_eq!(scanned[0].files, vec![rel.clone()]);
    fsx::delete_rel(&root, &rel).unwrap();
    assert!(fsx::scan_library(&root).unwrap()[0].files.is_empty());
}

#[test]
fn unique_slug_appends_suffix() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("library");
    std::fs::create_dir_all(&root).unwrap();
    assert_eq!(fsx::unique_slug(&root, "书"), "书");
    std::fs::create_dir_all(root.join("书")).unwrap();
    assert_eq!(fsx::unique_slug(&root, "书"), "书-2");
}
