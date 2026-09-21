//! M5 世界地图：导入白名单/大小上限/落盘、地点 CRUD 与坐标校验、级联删除。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::PlaceInput;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

/// 造一张假图文件（内容不解析，只校验扩展名与大小）
fn fake_image(dir: &std::path::Path, name: &str, bytes: &[u8]) -> String {
    let p = dir.join(name);
    std::fs::write(&p, bytes).unwrap();
    p.to_string_lossy().into_owned()
}

fn place_input(map_id: i64, name: &str, x: f64, y: f64) -> PlaceInput {
    PlaceInput {
        id: None,
        map_id,
        name: name.into(),
        description: "".into(),
        linked_character_ids: "".into(),
        x,
        y,
    }
}

#[test]
fn map_import_roundtrip_and_delete() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "world.png", b"fakepng");

    let m = cmd::map_import_inner(&s, book.id, "大陆全图", &src).unwrap();
    assert!(m.id > 0);
    assert_eq!(m.name, "大陆全图");
    assert!(m.path.contains("maps\\"), "落盘到 maps 目录：{}", m.path);
    assert!(std::path::Path::new(&m.path).is_file(), "图片已复制");

    let list = cmd::maps_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);

    let renamed = cmd::map_rename_inner(&s, m.id, "九州图").unwrap();
    assert_eq!(renamed.name, "九州图");

    cmd::map_delete_inner(&s, m.id).unwrap();
    assert!(cmd::maps_list_inner(&s, book.id).unwrap().is_empty());
    assert!(!std::path::Path::new(&m.path).is_file(), "删图连带删文件");
}

#[test]
fn map_import_blank_name_falls_back_to_file_stem() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "苍梧洲.png", b"x");
    let m = cmd::map_import_inner(&s, book.id, "  ", &src).unwrap();
    assert_eq!(m.name, "苍梧洲");
}

#[test]
fn map_import_ext_whitelist() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let bmp = fake_image(tmp.path(), "a.bmp", b"x");
    let err = cmd::map_import_inner(&s, book.id, "", &bmp).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "bmp 被拒：{err:?}");

    let missing = cmd::map_import_inner(&s, book.id, "", "no/such/file.png").unwrap_err();
    assert!(matches!(missing, AppError::NotFound(_)), "缺文件回 NotFound：{missing:?}");

    let upper = fake_image(tmp.path(), "b.PNG", b"x");
    assert!(cmd::map_import_inner(&s, book.id, "", &upper).is_ok(), "大写扩展名放行");
}

#[test]
fn map_import_oversize_rejected() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let big = fake_image(tmp.path(), "big.png", &vec![0u8; 10 * 1024 * 1024 + 1]);
    let err = cmd::map_import_inner(&s, book.id, "", &big).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "超 10MB 被拒：{err:?}");
}

#[test]
fn maps_scoped_by_book() {
    let (tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let f1 = fake_image(tmp.path(), "a.png", b"x");
    let f2 = fake_image(tmp.path(), "b.png", b"x");
    cmd::map_import_inner(&s, b1.id, "", &f1).unwrap();
    cmd::map_import_inner(&s, b2.id, "", &f2).unwrap();
    assert_eq!(cmd::maps_list_inner(&s, b1.id).unwrap().len(), 1);
    assert_eq!(cmd::maps_list_inner(&s, b2.id).unwrap().len(), 1);
}

#[test]
fn places_crud_roundtrip() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "m.png", b"x");
    let m = cmd::map_import_inner(&s, book.id, "", &src).unwrap();

    let p = cmd::place_upsert_inner(&s, &place_input(m.id, "青云山", 30.0, 45.5)).unwrap();
    assert!(p.id > 0);
    assert_eq!(p.book_id, book.id, "book_id 由 map 行派生");
    assert_eq!(p.x, 30.0);

    let list = cmd::places_list_inner(&s, m.id).unwrap();
    assert_eq!(list.len(), 1);

    let updated = cmd::place_upsert_inner(
        &s,
        &PlaceInput {
            id: Some(p.id),
            description: "主门所在".into(),
            linked_character_ids: "1,2".into(),
            ..place_input(m.id, "青云山", 31.0, 46.0)
        },
    )
    .unwrap();
    assert_eq!(updated.x, 31.0);
    assert_eq!(updated.linked_character_ids, "1,2");
    assert_eq!(cmd::places_list_inner(&s, m.id).unwrap().len(), 1, "更新不新增");

    cmd::place_delete_inner(&s, p.id).unwrap();
    assert!(cmd::places_list_inner(&s, m.id).unwrap().is_empty());
}

#[test]
fn place_validation_rejects_bad_input() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "m.png", b"x");
    let m = cmd::map_import_inner(&s, book.id, "", &src).unwrap();

    let blank = cmd::place_upsert_inner(&s, &place_input(m.id, "  ", 1.0, 1.0)).unwrap_err();
    assert!(matches!(blank, AppError::Invalid(_)), "空名称被拒：{blank:?}");

    let left = cmd::place_upsert_inner(&s, &place_input(m.id, "野", -0.1, 50.0)).unwrap_err();
    assert!(matches!(left, AppError::Invalid(_)), "x<0 被拒：{left:?}");
    let right = cmd::place_upsert_inner(&s, &place_input(m.id, "野", 100.1, 50.0)).unwrap_err();
    assert!(matches!(right, AppError::Invalid(_)), "x>100 被拒：{right:?}");

    let ghost = cmd::place_upsert_inner(&s, &place_input(999, "野", 1.0, 1.0)).unwrap_err();
    assert!(matches!(ghost, AppError::NotFound(_)), "map 不存在回 NotFound：{ghost:?}");
}

#[test]
fn delete_map_cascades_places() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "m.png", b"x");
    let m = cmd::map_import_inner(&s, book.id, "", &src).unwrap();
    cmd::place_upsert_inner(&s, &place_input(m.id, "甲城", 10.0, 10.0)).unwrap();
    cmd::place_upsert_inner(&s, &place_input(m.id, "乙城", 20.0, 20.0)).unwrap();

    cmd::map_delete_inner(&s, m.id).unwrap();
    assert!(cmd::places_list_inner(&s, m.id).unwrap().is_empty(), "删图级联删地点");
}

#[test]
fn place_update_missing_not_found() {
    let (tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let src = fake_image(tmp.path(), "m.png", b"x");
    let m = cmd::map_import_inner(&s, book.id, "", &src).unwrap();
    let err = cmd::place_upsert_inner(
        &s,
        &PlaceInput { id: Some(999), ..place_input(m.id, "野", 1.0, 1.0) },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "更新不存在的地点回 NotFound：{err:?}");
}
