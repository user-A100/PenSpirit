//! M7 批次3：wiki 双链扫描 / 反向链接 / 人物提及。
//! 链接以 [[章题]] 纯文本写进章文件，验证「扫描派生、不落库」语义。

use bixian::commands as cmd;
use bixian::fs_service;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

/// 直接往章文件写正文（绕过 write_chapter_inner 的历史快照，测试只关心内容）
fn put(s: &AppState, file_path: &str, content: &str) {
    fs_service::write_chapter(&s.root, file_path, content).unwrap();
}

#[test]
fn links_scan_resolves_same_book_titles_and_marks_unresolved() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "入山").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "下山").unwrap();
    put(&s, &c1.file_path, "他想起[[下山]]的约定，以及[[不存在的章]]。");
    put(&s, &c2.file_path, "无链");

    let links = cmd::links_scan_inner(&s, book.id).unwrap();
    assert_eq!(links.len(), 2, "只有 c1 有两条链");

    let resolved = links.iter().find(|l| l.target == "下山").unwrap();
    assert_eq!(resolved.from_id, c1.id);
    assert_eq!(resolved.to_id, Some(c2.id));
    assert_eq!(resolved.to_title.as_deref(), Some("下山"));
    assert!(resolved.snippet.contains("下山"), "摘录含上下文");

    let unresolved = links.iter().find(|l| l.target == "不存在的章").unwrap();
    assert_eq!(unresolved.to_id, None);
    assert_eq!(unresolved.to_title, None);
}

#[test]
fn links_scan_is_scoped_to_book_and_resolves_duplicate_title_to_first() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let a = cmd::create_chapter_inner(&s, b1.id, "第一章").unwrap();
    let dup1 = cmd::create_chapter_inner(&s, b1.id, "重名").unwrap();
    let dup2 = cmd::create_chapter_inner(&s, b1.id, "重名").unwrap();
    let other = cmd::create_chapter_inner(&s, b2.id, "别书章").unwrap();
    put(&s, &a.file_path, "[[重名]] [[别书章]]");

    let links = cmd::links_scan_inner(&s, b1.id).unwrap();
    assert_eq!(links.len(), 2);
    let dup = links.iter().find(|l| l.target == "重名").unwrap();
    assert_eq!(dup.to_id, Some(dup1.id), "重复章题消解到目录序最前");
    let cross = links.iter().find(|l| l.target == "别书章").unwrap();
    assert_eq!(cross.to_id, None, "跨书章题不消解");
    let _ = dup2;
}

#[test]
fn backlinks_exclude_self_and_unresolved() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    let c3 = cmd::create_chapter_inner(&s, book.id, "三").unwrap();
    put(&s, &c1.file_path, "参见[[二]]");
    put(&s, &c2.file_path, "自引[[二]]；再参见[[三]]");
    put(&s, &c3.file_path, "[[二]] 的回环");

    let back_of_2 = cmd::chapter_backlinks_inner(&s, c2.id).unwrap();
    let froms: Vec<i64> = back_of_2.iter().map(|b| b.from_id).collect();
    assert_eq!(froms, vec![c1.id, c3.id], "自引排除，一与三都链到二");
    assert!(back_of_2[0].snippet.contains("参见"));

    assert!(cmd::chapter_backlinks_inner(&s, c1.id).unwrap().is_empty());
}

#[test]
fn backlinks_ignores_soft_deleted_chapters() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    put(&s, &c1.file_path, "链[[二]]");
    cmd::delete_chapter_inner(&s, c1.id).unwrap();

    assert!(cmd::chapter_backlinks_inner(&s, c2.id).unwrap().is_empty());
}

#[test]
fn mentions_count_names_and_aliases_per_chapter() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    put(&s, &c1.file_path, "老张来了。张三也来了，老张又说话。");
    put(&s, &c2.file_path, "别章没有出场记录。");

    cmd::character_upsert_inner(
        &s,
        &bixian::models::CharacterInput {
            id: None,
            book_id: book.id,
            name: "张三".into(),
            role: "主角".into(),
            aliases: "老张， 张公子".into(),
            description: String::new(),
        },
    )
    .unwrap();
    cmd::character_upsert_inner(
        &s,
        &bixian::models::CharacterInput {
            id: None,
            book_id: book.id,
            name: "李四".into(),
            role: "配角".into(),
            aliases: String::new(),
            description: String::new(),
        },
    )
    .unwrap();

    let mentions = cmd::character_mentions_inner(&s, book.id).unwrap();
    let zhang_c1 = mentions
        .iter()
        .find(|m| m.name == "张三" && m.chapter_id == c1.id)
        .expect("张三在第一章有提及");
    assert_eq!(zhang_c1.count, 3, "老张×2 + 张三×1，别名同权");
    // 李四零提及不返回；第二章无张三提及
    assert!(mentions.iter().all(|m| m.name != "李四"));
    assert!(!mentions.iter().any(|m| m.chapter_id == c2.id && m.name == "张三"));
}
