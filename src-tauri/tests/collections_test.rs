use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::CollectionInput;
use bixian::state::AppState;
use bixian::trash;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn manual_input(book_id: i64, name: &str) -> CollectionInput {
    CollectionInput { id: None, book_id, name: name.into(), kind: "manual".into(), query: String::new() }
}

#[test]
fn manual_collection_crud_and_validation() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();

    let col = cmd::collection_upsert_inner(&s, &manual_input(book.id, "主线")).unwrap();
    assert_eq!(col.name, "主线");
    assert_eq!(col.kind, "manual");
    assert!(col.query.is_empty());
    assert!(!col.created_at.is_empty());

    // 同书重名拒绝
    let err = cmd::collection_upsert_inner(&s, &manual_input(book.id, "主线")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(ref m) if m.contains("已存在")));

    // 空名 / 纯空白名拒绝
    for bad in ["", "   "] {
        let e = cmd::collection_upsert_inner(&s, &manual_input(book.id, bad)).unwrap_err();
        assert!(matches!(e, AppError::Invalid(ref m) if m.contains("不能为空")));
    }

    // 非法 kind 拒绝
    let e = cmd::collection_upsert_inner(&s, &CollectionInput {
        id: None, book_id: book.id, name: "坏".into(), kind: "sticky".into(), query: String::new(),
    }).unwrap_err();
    assert!(matches!(e, AppError::Invalid(ref m) if m.contains("类型")));

    // 改名：kind/book_id 不动，query 可更新
    let renamed = cmd::collection_upsert_inner(&s, &CollectionInput {
        id: Some(col.id), book_id: book.id, name: "  伏笔线  ".into(), kind: "saved".into(), query: "风雪".into(),
    }).unwrap();
    assert_eq!(renamed.name, "伏笔线", "名字去首尾空白");
    assert_eq!(renamed.kind, "manual", "kind 不随更新改");
    assert_eq!(renamed.query, "风雪");

    let e = cmd::collection_upsert_inner(&s, &CollectionInput {
        id: Some(999_999), book_id: book.id, name: "幽灵".into(), kind: "manual".into(), query: String::new(),
    }).unwrap_err();
    assert!(matches!(e, AppError::NotFound(_)), "更新的 id 不存在 → NotFound");

    // 删除后列表为空
    cmd::collection_delete_inner(&s, col.id).unwrap();
    assert!(cmd::collections_list_inner(&s, book.id).unwrap().is_empty());
}

#[test]
fn manual_membership_order_and_cross_book_guard() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "本书").unwrap();
    let b2 = cmd::create_book_inner(&s, "他书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, b1.id, "一").unwrap().id;
    let c2 = cmd::create_chapter_inner(&s, b1.id, "二").unwrap().id;
    let c3 = cmd::create_chapter_inner(&s, b1.id, "三").unwrap().id;
    let foreign = cmd::create_chapter_inner(&s, b2.id, "外章").unwrap().id;

    let col = cmd::collection_upsert_inner(&s, &manual_input(b1.id, "精选")).unwrap();

    // 跨书加入拒绝
    let e = cmd::collection_add_chapters_inner(&s, col.id, &[foreign]).unwrap_err();
    assert!(matches!(e, AppError::Invalid(ref m) if m.contains("不属于")));

    // 乱序加入 → 按书目录序返回
    let ids = cmd::collection_add_chapters_inner(&s, col.id, &[c3, c1, c2]).unwrap();
    assert_eq!(ids, vec![c1, c2, c3]);

    // 重复加入幂等
    let again = cmd::collection_add_chapters_inner(&s, col.id, &[c1]).unwrap();
    assert_eq!(again, vec![c1, c2, c3]);

    // 移除一章
    let after = cmd::collection_remove_chapter_inner(&s, col.id, c2).unwrap();
    assert_eq!(after, vec![c1, c3]);

    // 成员视图按书序返回 ChapterMeta
    let metas = cmd::collection_chapters_inner(&s, col.id).unwrap();
    let titles: Vec<&str> = metas.iter().map(|m| m.title.as_str()).collect();
    assert_eq!(titles, vec!["一", "三"]);
}

#[test]
fn soft_deleted_chapter_drops_out_and_returns_on_restore() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap().id;
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap().id;

    let col = cmd::collection_upsert_inner(&s, &manual_input(book.id, "选")).unwrap();
    cmd::collection_add_chapters_inner(&s, col.id, &[c1, c2]).unwrap();

    cmd::delete_chapter_inner(&s, c1).unwrap();
    let ids = cmd::collection_chapters_inner(&s, col.id).unwrap();
    assert_eq!(ids.iter().map(|m| m.id).collect::<Vec<_>>(), vec![c2], "回收站章不出现");

    trash::restore_chapter_inner(&s, c1).unwrap();
    let ids = cmd::collection_chapters_inner(&s, col.id).unwrap();
    assert_eq!(ids.iter().map(|m| m.id).collect::<Vec<_>>(), vec![c1, c2], "恢复后成员关系保留");
}

#[test]
fn saved_collection_lives_on_query() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap().id;
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap().id;
    cmd::write_chapter_inner(&s, c1, "风雪很大。").unwrap();
    cmd::write_chapter_inner(&s, c2, "无关正文。").unwrap();

    let col = cmd::collection_upsert_inner(&s, &CollectionInput {
        id: None, book_id: book.id, name: "风雪".into(), kind: "saved".into(), query: "风雪".into(),
    }).unwrap();

    let members = cmd::collection_chapters_inner(&s, col.id).unwrap();
    assert_eq!(members.iter().map(|m| m.id).collect::<Vec<_>>(), vec![c1]);

    // 正文变化 → 结果实时跟随
    cmd::write_chapter_inner(&s, c2, "也有风雪了。").unwrap();
    let members = cmd::collection_chapters_inner(&s, col.id).unwrap();
    assert_eq!(members.iter().map(|m| m.id).collect::<Vec<_>>(), vec![c1, c2], "按书目录序");

    // saved 集合禁手动增删
    let e = cmd::collection_add_chapters_inner(&s, col.id, &[c1]).unwrap_err();
    assert!(matches!(e, AppError::Invalid(ref m) if m.contains("不能手动添加")));
    let e = cmd::collection_remove_chapter_inner(&s, col.id, c1).unwrap_err();
    assert!(matches!(e, AppError::Invalid(ref m) if m.contains("不能手动移除")));

    // 查询清空 → 成员为空
    cmd::collection_upsert_inner(&s, &CollectionInput {
        id: Some(col.id), book_id: book.id, name: "风雪".into(), kind: "saved".into(), query: "   ".into(),
    }).unwrap();
    assert!(cmd::collection_chapters_inner(&s, col.id).unwrap().is_empty());
}
