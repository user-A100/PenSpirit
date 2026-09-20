//! M4 人物卡 CRUD：插入/更新/删除/按书列表，姓名空校验。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::CharacterInput;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn input(book_id: i64, name: &str, role: &str, aliases: &str, desc: &str) -> CharacterInput {
    CharacterInput {
        id: None,
        book_id,
        name: name.into(),
        role: role.into(),
        aliases: aliases.into(),
        description: desc.into(),
    }
}

#[test]
fn characters_crud_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();

    // 插入两条
    let c1 = cmd::character_upsert_inner(&s, &input(book.id, "胡八一", "主角", "老胡,八一", "摸金校尉")).unwrap();
    let c2 = cmd::character_upsert_inner(&s, &input(book.id, "Shirley杨", "主角", "", "华侨")).unwrap();
    assert!(c1.id < c2.id, "按创建顺序排列");

    let list = cmd::characters_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "胡八一");
    assert_eq!(list[0].aliases, "老胡,八一");

    // 更新：改名不改属主
    let updated = cmd::character_upsert_inner(
        &s,
        &CharacterInput { id: Some(c1.id), ..input(book.id, "胡建军", "主角", "老胡", "本名胡建军") },
    )
    .unwrap();
    assert_eq!(updated.name, "胡建军");
    assert_eq!(updated.aliases, "老胡");
    assert_eq!(cmd::characters_list_inner(&s, book.id).unwrap().len(), 2, "更新不新增");

    // 删除
    cmd::character_delete_inner(&s, c2.id).unwrap();
    let after = cmd::characters_list_inner(&s, book.id).unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].id, c1.id);
}

#[test]
fn character_name_blank_rejected() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let err = cmd::character_upsert_inner(&s, &input(book.id, "  ", "", "", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "空姓名被拒：{err:?}");
}

#[test]
fn character_update_missing_not_found() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let err = cmd::character_upsert_inner(
        &s,
        &CharacterInput { id: Some(999), ..input(book.id, "幽灵", "", "", "") },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "更新不存在的卡回 NotFound：{err:?}");
}

#[test]
fn characters_scoped_by_book() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    cmd::character_upsert_inner(&s, &input(b1.id, "甲", "", "", "")).unwrap();
    cmd::character_upsert_inner(&s, &input(b2.id, "乙", "", "", "")).unwrap();

    assert_eq!(cmd::characters_list_inner(&s, b1.id).unwrap().len(), 1);
    assert_eq!(cmd::characters_list_inner(&s, b2.id).unwrap()[0].name, "乙");
}
