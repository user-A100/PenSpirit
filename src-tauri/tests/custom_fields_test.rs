//! M7 批次7 自定义字段与自由卡片墙摆位：定义 CRUD / 值校验 / 坐标读写。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::CustomFieldDefInput;
use bixian::state::AppState;
use serde_json::json;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn def_input(book_id: i64, name: &str, field_type: &str, options: &str) -> CustomFieldDefInput {
    CustomFieldDefInput {
        id: None,
        book_id,
        name: name.into(),
        field_type: field_type.into(),
        list_options: options.into(),
        sort_key: 0,
    }
}

#[test]
fn def_crud_with_type_and_name_validation() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();

    let text = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "视角", "text", "[]")).unwrap();
    assert_eq!(text.name, "视角");
    assert_eq!(text.field_type, "text");
    assert_eq!(text.list_options, "[]");

    let list = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "主线", "list", r#"["红","蓝"]"#)).unwrap();
    assert_eq!(list.list_options, r#"["红","蓝"]"#);

    let check = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "已审", "checkbox", "whatever")).unwrap();
    assert_eq!(check.list_options, "[]", "非 list 型选项归一为空数组");

    let date = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "截稿", "date", "[]")).unwrap();
    assert_eq!(date.field_type, "date");

    // 列表按 sort_key, id 序
    let defs = cmd::custom_defs_list_inner(&s, book.id).unwrap();
    let names: Vec<_> = defs.iter().map(|d| d.name.as_str()).collect();
    assert_eq!(names, vec!["视角", "主线", "已审", "截稿"]);

    // 重名拒绝 / 改名撞名拒绝 / 空名拒绝
    assert!(cmd::custom_def_upsert_inner(&s, &def_input(book.id, "视角", "text", "[]")).is_err());
    let renamed = CustomFieldDefInput { id: Some(list.id), name: "视角".into(), ..def_input(book.id, "主线", "list", r#"["红"]"#) };
    assert!(matches!(cmd::custom_def_upsert_inner(&s, &renamed).unwrap_err(), AppError::Invalid(ref m) if m.contains("已存在")));
    assert!(matches!(
        cmd::custom_def_upsert_inner(&s, &def_input(book.id, "  ", "text", "[]")).unwrap_err(),
        AppError::Invalid(ref m) if m.contains("不能为空")
    ));

    // 非法类型 / list 空选项
    assert!(matches!(
        cmd::custom_def_upsert_inner(&s, &def_input(book.id, "坏", "enum", "[]")).unwrap_err(),
        AppError::Invalid(ref m) if m.contains("未知字段类型")
    ));
    assert!(cmd::custom_def_upsert_inner(&s, &def_input(book.id, "坏", "list", "[]")).is_err());
    assert!(cmd::custom_def_upsert_inner(&s, &def_input(book.id, "坏", "list", r#"[1,2]"#)).is_err());
    assert!(cmd::custom_def_upsert_inner(&s, &def_input(book.id, "坏", "list", r#"["a"," "]"#)).is_err());

    // 删除 + NotFound
    cmd::custom_def_delete_inner(&s, check.id).unwrap();
    assert!(matches!(
        cmd::custom_def_delete_inner(&s, check.id).unwrap_err(),
        AppError::NotFound(_)
    ));
}

#[test]
fn values_validate_shape_membership_and_ownership() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let other = cmd::create_book_inner(&s, "他书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap().id;
    let foreign_ch = cmd::create_chapter_inner(&s, other.id, "外章").unwrap().id;
    let text = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "视角", "text", "[]")).unwrap();
    let check = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "已审", "checkbox", "[]")).unwrap();
    let list = cmd::custom_def_upsert_inner(&s, &def_input(book.id, "主线", "list", r#"["红","蓝"]"#)).unwrap();

    // 各型合法写入
    cmd::custom_value_set_inner(&s, ch, text.id, Some(json!("第一人称"))).unwrap();
    cmd::custom_value_set_inner(&s, ch, check.id, Some(json!(true))).unwrap();
    cmd::custom_value_set_inner(&s, ch, list.id, Some(json!("蓝"))).unwrap();
    let vals = cmd::custom_values_get_inner(&s, ch).unwrap();
    assert_eq!(vals.get(&text.id.to_string()), Some(&json!("第一人称")));
    assert_eq!(vals.get(&check.id.to_string()), Some(&json!(true)));
    assert_eq!(vals.get(&list.id.to_string()), Some(&json!("蓝")));

    // 形状不符
    assert!(cmd::custom_value_set_inner(&s, ch, check.id, Some(json!("是"))).is_err());
    assert!(cmd::custom_value_set_inner(&s, ch, text.id, Some(json!(3))).is_err());
    // list 成员校验
    assert!(cmd::custom_value_set_inner(&s, ch, list.id, Some(json!("绿"))).is_err());
    // 跨书引用拒绝
    assert!(cmd::custom_value_set_inner(&s, foreign_ch, text.id, Some(json!("x"))).is_err());

    // None 清除键
    cmd::custom_value_set_inner(&s, ch, check.id, None).unwrap();
    let vals = cmd::custom_values_get_inner(&s, ch).unwrap();
    assert!(vals.get(&check.id.to_string()).is_none());
    assert_eq!(vals.len(), 2);

    // def 删除后值成孤儿键，但不影响读取
    cmd::custom_def_delete_inner(&s, text.id).unwrap();
    let vals = cmd::custom_values_get_inner(&s, ch).unwrap();
    assert_eq!(vals.get(&text.id.to_string()), Some(&json!("第一人称")));
    // 不存在的 def 拒写
    assert!(matches!(
        cmd::custom_value_set_inner(&s, ch, 999_999, Some(json!("x"))).unwrap_err(),
        AppError::NotFound(_)
    ));
}

#[test]
fn freeform_positions_roundtrip_and_isolation() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let other = cmd::create_book_inner(&s, "他书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap().id;
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap().id;
    cmd::create_chapter_inner(&s, other.id, "外章").unwrap();

    // 初始全 0
    let pos = cmd::freeform_positions_inner(&s, book.id).unwrap();
    assert_eq!(pos, vec![
        bixian::models::FreeformPos { chapter_id: c1, x: 0.0, y: 0.0 },
        bixian::models::FreeformPos { chapter_id: c2, x: 0.0, y: 0.0 },
    ]);

    cmd::freeform_position_set_inner(&s, c2, 320.5, 88.0).unwrap();
    let pos = cmd::freeform_positions_inner(&s, book.id).unwrap();
    assert_eq!(pos[1].x, 320.5);
    assert_eq!(pos[1].y, 88.0);
    assert_eq!(pos[0].x, 0.0, "未动的章坐标保持 0");
    // 书间隔离
    assert!(cmd::freeform_positions_inner(&s, other.id).unwrap().iter().all(|p| p.x == 0.0 && p.y == 0.0));
    // 不存在的章
    assert!(matches!(
        cmd::freeform_position_set_inner(&s, 999_999, 1.0, 1.0).unwrap_err(),
        AppError::NotFound(_)
    ));
}
