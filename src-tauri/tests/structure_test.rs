//! M7 批次2：章节重排（reorder）与章节模板（默认模板建章套用）。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::ChapterTemplateInput;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn tpl(book_id: i64, name: &str, content: &str, is_default: bool) -> ChapterTemplateInput {
    ChapterTemplateInput { id: None, book_id, name: name.into(), content: content.into(), is_default }
}

#[test]
fn chapters_reorder_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    let c3 = cmd::create_chapter_inner(&s, book.id, "三").unwrap();

    cmd::reorder_chapters_inner(&s, &[c3.id, c1.id, c2.id]).unwrap();
    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    let titles: Vec<&str> = list.iter().map(|c| c.title.as_str()).collect();
    assert_eq!(titles, vec!["三", "一", "二"], "按传入顺序排列");
}

#[test]
fn chapters_reorder_cross_book_rejected() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let c1 = cmd::create_chapter_inner(&s, b1.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, b2.id, "二").unwrap();
    let err = cmd::reorder_chapters_inner(&s, &[c1.id, c2.id]).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
}

#[test]
fn chapters_reorder_empty_ok_and_renames_keep_order() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    cmd::reorder_chapters_inner(&s, &[]).unwrap();

    // 重排后改名不改序（rename 只动标题/路径）
    cmd::reorder_chapters_inner(&s, &[c2.id, c1.id]).unwrap();
    cmd::rename_chapter_inner(&s, c2.id, "贰").unwrap();
    let list = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(list[0].title, "贰");
    assert_eq!(list[1].title, "一");
}

#[test]
fn template_crud_and_default_exclusivity() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();

    let t1 = cmd::template_upsert_inner(&s, &tpl(book.id, "打斗", "## 遇袭\n", false)).unwrap();
    let t2 = cmd::template_upsert_inner(&s, &tpl(book.id, "对话", "## 密谈\n", false)).unwrap();
    assert_eq!(cmd::templates_list_inner(&s, book.id).unwrap().len(), 2);

    // 设默认独占
    let d1 = cmd::template_set_default_inner(&s, t1.id, true).unwrap();
    assert!(d1.is_default);
    let d2 = cmd::template_set_default_inner(&s, t2.id, true).unwrap();
    assert!(d2.is_default);
    let list = cmd::templates_list_inner(&s, book.id).unwrap();
    assert_eq!(list.iter().filter(|t| t.is_default).count(), 1, "默认位独占");
    assert_eq!(list.iter().find(|t| t.id == t1.id).unwrap().is_default, false);

    // 更新（改名改内容）
    let updated = cmd::template_upsert_inner(
        &s,
        &ChapterTemplateInput { id: Some(t1.id), book_id: book.id, name: "打斗二".into(), content: "## 遇袭二\n".into(), is_default: false },
    )
    .unwrap();
    assert_eq!(updated.name, "打斗二");

    // 同书重名被拒
    let err = cmd::template_upsert_inner(&s, &tpl(book.id, "打斗二", "x", false)).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));

    // 空名被拒
    let err = cmd::template_upsert_inner(&s, &tpl(book.id, "  ", "x", false)).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));

    cmd::template_delete_inner(&s, t1.id).unwrap();
    assert_eq!(cmd::templates_list_inner(&s, book.id).unwrap().len(), 1);
}

#[test]
fn create_chapter_applies_default_template_content() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();

    // 无默认模板：新章为空
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    let full = cmd::read_chapter_inner(&s, ch.id).unwrap();
    assert_eq!(full.content, "");

    // 设默认模板后再建：初始正文即模板
    cmd::template_upsert_inner(&s, &tpl(book.id, "章法", "## 场景\n\n草稿骨架", true)).unwrap();
    let ch2 = cmd::create_chapter_inner(&s, book.id, "二").unwrap();
    let full2 = cmd::read_chapter_inner(&s, ch2.id).unwrap();
    assert_eq!(full2.content, "## 场景\n\n草稿骨架");

    // 清默认后回到空章
    cmd::template_set_default_inner(&s, cmd::templates_list_inner(&s, book.id).unwrap()[0].id, false).unwrap();
    let ch3 = cmd::create_chapter_inner(&s, book.id, "三").unwrap();
    assert_eq!(cmd::read_chapter_inner(&s, ch3.id).unwrap().content, "");
}
