//! M4 大纲体系：总纲/卷纲/章细纲 CRUD、唯一性约束（每书一篇总纲、每章一篇细纲）。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::OutlineInput;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn input(
    book_id: i64,
    kind: &str,
    chapter_id: Option<i64>,
    title: &str,
    content: &str,
) -> OutlineInput {
    OutlineInput {
        id: None,
        book_id,
        kind: kind.into(),
        chapter_id,
        title: title.into(),
        content: content.into(),
        sort_key: 0,
    }
}

#[test]
fn master_volume_chapter_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let ch2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();

    let master = cmd::outline_upsert_inner(&s, &input(book.id, "master", None, "", "全书主线。")).unwrap();
    let vol1 = cmd::outline_upsert_inner(
        &s,
        &OutlineInput { sort_key: 1, ..input(book.id, "volume", None, "第一卷 风雪", "卷一说明。") },
    )
    .unwrap();
    let vol2 = cmd::outline_upsert_inner(
        &s,
        &OutlineInput { sort_key: 2, ..input(book.id, "volume", None, "第二卷 南下", "") },
    )
    .unwrap();
    let d1 = cmd::outline_upsert_inner(&s, &input(book.id, "chapter", Some(ch1.id), "", "开篇要点。")).unwrap();

    let list = cmd::outlines_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 4);
    // 排序：master → volume（sort_key）→ chapter
    let kinds: Vec<&str> = list.iter().map(|o| o.kind.as_str()).collect();
    assert_eq!(kinds, vec!["master", "volume", "volume", "chapter"]);
    assert_eq!(list[1].title, "第一卷 风雪");
    assert_eq!(list[2].title, "第二卷 南下");
    assert_eq!(list[3].chapter_id, Some(ch1.id));

    // 更新细纲内容（同 id 同章，合法）
    let updated = cmd::outline_upsert_inner(
        &s,
        &OutlineInput { id: Some(d1.id), content: "改后要点。".into(), ..input(book.id, "chapter", Some(ch1.id), "", "") },
    )
    .unwrap();
    assert_eq!(updated.content, "改后要点。");

    // 删除卷纲
    cmd::outline_delete_inner(&s, vol1.id).unwrap();
    cmd::outline_delete_inner(&s, vol2.id).unwrap();
    assert_eq!(cmd::outlines_list_inner(&s, book.id).unwrap().len(), 2);

    // 章软删（进回收站）不级联——细纲保留，章恢复即回；
    // 回收站永久删除（物理 DELETE）才触发 FK 级联清细纲
    cmd::delete_chapter_inner(&s, ch1.id).unwrap();
    assert_eq!(cmd::outlines_list_inner(&s, book.id).unwrap().len(), 2, "软删不丢细纲");
    let _ = ch2;
}

#[test]
fn master_unique_per_book() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    cmd::outline_upsert_inner(&s, &input(book.id, "master", None, "", "第一篇总纲")).unwrap();
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "master", None, "", "第二篇总纲")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "重复总纲被拒：{err:?}");

    // 另一本书不受影响
    let book2 = cmd::create_book_inner(&s, "书二").unwrap();
    assert!(cmd::outline_upsert_inner(&s, &input(book2.id, "master", None, "", "ok")).is_ok());
}

#[test]
fn chapter_outline_unique_per_chapter() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::outline_upsert_inner(&s, &input(book.id, "chapter", Some(ch.id), "", "已有细纲")).unwrap();
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "chapter", Some(ch.id), "", "又一篇")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "同章二细纲被拒：{err:?}");
}

#[test]
fn invalid_kinds_and_shapes_rejected() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();

    // 非法 kind
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "arc", None, "", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    // 细纲必须带章
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "chapter", None, "", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    // 总纲不能带章
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "master", Some(ch.id), "", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    // 卷纲卷名必填
    let err = cmd::outline_upsert_inner(&s, &input(book.id, "volume", None, "  ", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    // 更新不存在 → NotFound
    let err = cmd::outline_upsert_inner(
        &s,
        &OutlineInput { id: Some(999), ..input(book.id, "volume", None, "卷", "") },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}
