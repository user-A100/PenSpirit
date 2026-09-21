//! M5 角色关系 CRUD：自引用/跨书/空类型拒绝、重复静默转更新、级联删除。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::{CharacterInput, CharacterRelationInput};
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn char_input(book_id: i64, name: &str) -> CharacterInput {
    CharacterInput {
        id: None,
        book_id,
        name: name.into(),
        role: "".into(),
        aliases: "".into(),
        description: "".into(),
    }
}

fn rel_input(book_id: i64, source: i64, target: i64, ty: &str, note: &str) -> CharacterRelationInput {
    CharacterRelationInput {
        id: None,
        book_id,
        source_id: source,
        target_id: target,
        relation_type: ty.into(),
        note: note.into(),
    }
}

#[test]
fn relations_crud_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "胡八一")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "胖子")).unwrap();

    let rel = cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "挚友", "过命交情")).unwrap();
    assert!(rel.id > 0);
    assert_eq!(rel.relation_type, "挚友");
    assert_eq!(rel.note, "过命交情");

    let list = cmd::relations_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);

    // 更新 note（id=Some）
    let updated = cmd::relation_upsert_inner(
        &s,
        &CharacterRelationInput { id: Some(rel.id), note: "生死之交".into(), ..rel_input(book.id, a.id, b.id, "挚友", "") },
    )
    .unwrap();
    assert_eq!(updated.note, "生死之交");
    assert_eq!(cmd::relations_list_inner(&s, book.id).unwrap().len(), 1, "更新不新增");

    cmd::relation_delete_inner(&s, rel.id).unwrap();
    assert!(cmd::relations_list_inner(&s, book.id).unwrap().is_empty());
}

#[test]
fn relation_self_reference_rejected() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let err = cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, a.id, "挚友", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "自引用被拒：{err:?}");
}

#[test]
fn relation_cross_book_rejected() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(b1.id, "甲")).unwrap();
    let c = cmd::character_upsert_inner(&s, &char_input(b2.id, "乙")).unwrap();
    let err = cmd::relation_upsert_inner(&s, &rel_input(b1.id, a.id, c.id, "仇敌", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "跨书关系被拒：{err:?}");
}

#[test]
fn relation_blank_type_rejected() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "乙")).unwrap();
    let err = cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "  ", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "空类型被拒：{err:?}");
}

#[test]
fn relation_duplicate_insert_updates_note() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "乙")).unwrap();
    cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "配偶", "")).unwrap();
    let again = cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "配偶", "原配")).unwrap();
    let list = cmd::relations_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1, "重复插入不新增行");
    assert_eq!(list[0].id, again.id);
    assert_eq!(list[0].note, "原配", "重复插入静默转更新 note");
}

#[test]
fn relation_update_type_duplicate_rejected() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "乙")).unwrap();
    cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "父母", "")).unwrap();
    let other = cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "仇敌", "")).unwrap();
    let err = cmd::relation_upsert_inner(
        &s,
        &CharacterRelationInput { id: Some(other.id), relation_type: "父母".into(), ..rel_input(book.id, a.id, b.id, "", "") },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "改型撞已有行被拒：{err:?}");
}

#[test]
fn relation_reverse_pair_allowed() {
    // 数据层不拦方向：A→(父母)B 与 B→(子女)A 各自成行，家族树布局层负责归一
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "父")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "子")).unwrap();
    cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "父母", "")).unwrap();
    cmd::relation_upsert_inner(&s, &rel_input(book.id, b.id, a.id, "子女", "")).unwrap();
    assert_eq!(cmd::relations_list_inner(&s, book.id).unwrap().len(), 2);
}

#[test]
fn delete_character_cascades_relations() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "乙")).unwrap();
    cmd::relation_upsert_inner(&s, &rel_input(book.id, a.id, b.id, "师徒", "")).unwrap();
    cmd::character_delete_inner(&s, a.id).unwrap();
    assert!(cmd::relations_list_inner(&s, book.id).unwrap().is_empty(), "删角色级联删关系");
}

#[test]
fn relation_update_missing_not_found() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let a = cmd::character_upsert_inner(&s, &char_input(book.id, "甲")).unwrap();
    let b = cmd::character_upsert_inner(&s, &char_input(book.id, "乙")).unwrap();
    let err = cmd::relation_upsert_inner(
        &s,
        &CharacterRelationInput { id: Some(999), ..rel_input(book.id, a.id, b.id, "挚友", "") },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "更新不存在的关系回 NotFound：{err:?}");
}
