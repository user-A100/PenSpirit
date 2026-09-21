//! M7 批次1：章节元数据层 —— 建书种子、标签/状态 CRUD、章元数据部分更新、关键词替换。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::{ChapterMetaUpdate, LabelInput, StatusInput};
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn update(synopsis: Option<&str>, label: Option<Option<i64>>, status: Option<Option<i64>>, target: Option<Option<i64>>) -> ChapterMetaUpdate {
    ChapterMetaUpdate {
        synopsis: synopsis.map(str::to_string),
        label_id: label,
        status_id: status,
        target_words: target,
    }
}

#[test]
fn create_book_seeds_statuses_and_labels() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let statuses = cmd::statuses_list_inner(&s, book.id).unwrap();
    let labels = cmd::labels_list_inner(&s, book.id).unwrap();
    assert_eq!(statuses.len(), 6, "六状态种子");
    assert_eq!(statuses[0].title, "待写");
    assert_eq!(statuses[5].title, "已完成");
    assert_eq!(labels.len(), 6, "六色标签种子");
    assert_eq!(labels[0].title, "红");
    assert!(labels[0].color.starts_with('#'), "标签带色值");
    // sort_key 有序
    assert!(labels.windows(2).all(|w| w[0].sort_key < w[1].sort_key));
}

#[test]
fn label_crud_roundtrip() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();

    // 插入
    let l = cmd::label_upsert_inner(&s, &LabelInput { id: None, book_id: book.id, title: "主线".into(), color: "#f87171".into() }).unwrap();
    // 更新（改名改色，不新增）
    let updated = cmd::label_upsert_inner(&s, &LabelInput { id: Some(l.id), book_id: book.id, title: "主线A".into(), color: "#60a5fa".into() }).unwrap();
    assert_eq!(updated.title, "主线A");
    assert_eq!(updated.color, "#60a5fa");
    assert_eq!(cmd::labels_list_inner(&s, book.id).unwrap().len(), 7, "种子6 + 新增1");

    // 空名被拒
    let err = cmd::label_upsert_inner(&s, &LabelInput { id: None, book_id: book.id, title: "  ".into(), color: "#fff".into() }).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));

    // 更新不存在的
    let err = cmd::label_upsert_inner(&s, &LabelInput { id: Some(99999), book_id: book.id, title: "x".into(), color: "#fff".into() }).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}

#[test]
fn chapter_meta_partial_update() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "第一章").unwrap();
    let labels = cmd::labels_list_inner(&s, book.id).unwrap();
    let statuses = cmd::statuses_list_inner(&s, book.id).unwrap();

    // 全空 update 不动任何字段
    let same = cmd::chapter_update_meta_inner(&s, ch.id, &update(None, None, None, None)).unwrap();
    assert_eq!(same.synopsis, "");
    assert_eq!(same.label_id, None);

    // 设梗概 + 目标 + 标签 + 状态
    let m = cmd::chapter_update_meta_inner(&s, ch.id, &update(Some(" 少年入山 "), Some(Some(labels[0].id)), Some(Some(statuses[1].id)), Some(Some(3000)))).unwrap();
    assert_eq!(m.synopsis, "少年入山", "梗概去空白");
    assert_eq!(m.label_id, Some(labels[0].id));
    assert_eq!(m.status_id, Some(statuses[1].id));
    assert_eq!(m.target_words, Some(3000));
    let fresh = cmd::list_chapters_inner(&s, book.id).unwrap()[0].clone();
    assert_eq!(fresh.synopsis, "少年入山");

    // 部分 update：只改梗概，标签不动
    let m2 = cmd::chapter_update_meta_inner(&s, ch.id, &update(Some("新梗概"), None, None, None)).unwrap();
    assert_eq!(m2.synopsis, "新梗概");
    assert_eq!(m2.label_id, Some(labels[0].id), "未提及字段不被清");

    // null 清空
    let m3 = cmd::chapter_update_meta_inner(&s, ch.id, &update(None, Some(None), Some(None), Some(None))).unwrap();
    assert_eq!(m3.label_id, None);
    assert_eq!(m3.status_id, None);
    assert_eq!(m3.target_words, None);
    assert_eq!(m3.synopsis, "新梗概", "null 不误伤其他字段");
}

#[test]
fn chapter_meta_cross_book_ref_rejected() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let ch = cmd::create_chapter_inner(&s, b1.id, "第一章").unwrap();
    let b2_labels = cmd::labels_list_inner(&s, b2.id).unwrap();
    let b2_statuses = cmd::statuses_list_inner(&s, b2.id).unwrap();

    let err = cmd::chapter_update_meta_inner(&s, ch.id, &update(None, Some(Some(b2_labels[0].id)), None, None)).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "跨书标签被拒");
    let err = cmd::chapter_update_meta_inner(&s, ch.id, &update(None, None, Some(Some(b2_statuses[0].id)), None)).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "跨书状态被拒");
    // 失败不落库
    assert_eq!(cmd::list_chapters_inner(&s, b1.id).unwrap()[0].label_id, None);
}

#[test]
fn label_delete_nulls_chapter_reference() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "第一章").unwrap();
    let labels = cmd::labels_list_inner(&s, book.id).unwrap();
    cmd::chapter_update_meta_inner(&s, ch.id, &update(None, Some(Some(labels[0].id)), None, None)).unwrap();

    cmd::label_delete_inner(&s, labels[0].id).unwrap();
    assert_eq!(cmd::list_chapters_inner(&s, book.id).unwrap()[0].label_id, None, "删定义置空章引用");
}

#[test]
fn keywords_create_unique_and_set_replace_all() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "第一章").unwrap();

    let k1 = cmd::keyword_create_inner(&s, book.id, "修仙", None).unwrap();
    let k2 = cmd::keyword_create_inner(&s, book.id, "权谋", None).unwrap();
    assert_ne!(k1.color, "", "自动配色非空");

    // 书内去重
    let err = cmd::keyword_create_inner(&s, book.id, "修仙", Some("#fff")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));

    // replace-all：设两个 → 换成一个
    let now = cmd::chapter_set_keywords_inner(&s, ch.id, &[k1.id, k2.id]).unwrap();
    assert_eq!(now.len(), 2);
    let trimmed = cmd::chapter_set_keywords_inner(&s, ch.id, &[k2.id]).unwrap();
    assert_eq!(trimmed.len(), 1);
    assert_eq!(trimmed[0].id, k2.id);
    let read_back = cmd::keywords_for_chapter_inner(&s, ch.id).unwrap();
    assert_eq!(read_back.len(), 1, "读回一致");

    // 空数组清空
    let empty = cmd::chapter_set_keywords_inner(&s, ch.id, &[]).unwrap();
    assert!(empty.is_empty());
}

#[test]
fn chapter_keywords_cross_book_rejected() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    let ch = cmd::create_chapter_inner(&s, b1.id, "第一章").unwrap();
    let b2_k = cmd::keyword_create_inner(&s, b2.id, "异书词", None).unwrap();

    let err = cmd::chapter_set_keywords_inner(&s, ch.id, &[b2_k.id]).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    assert!(cmd::keywords_for_chapter_inner(&s, ch.id).unwrap().is_empty(), "被拒不落库");
}

#[test]
fn keyword_delete_cascades_chapter_link() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "第一章").unwrap();
    let k = cmd::keyword_create_inner(&s, book.id, "悬疑", None).unwrap();
    cmd::chapter_set_keywords_inner(&s, ch.id, &[k.id]).unwrap();

    cmd::keyword_delete_inner(&s, k.id).unwrap();
    assert!(cmd::keywords_for_chapter_inner(&s, ch.id).unwrap().is_empty(), "删词级联清章链接");
}

#[test]
fn status_crud_and_missing_not_found() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "测试书").unwrap();
    let st = cmd::status_upsert_inner(&s, &StatusInput { id: None, book_id: book.id, title: "搁置".into() }).unwrap();
    let updated = cmd::status_upsert_inner(&s, &StatusInput { id: Some(st.id), book_id: book.id, title: "暂停".into() }).unwrap();
    assert_eq!(updated.title, "暂停");
    cmd::status_delete_inner(&s, st.id).unwrap();
    assert_eq!(cmd::statuses_list_inner(&s, book.id).unwrap().len(), 6, "回到种子数");

    let err = cmd::status_upsert_inner(&s, &StatusInput { id: Some(st.id), book_id: book.id, title: "x".into() }).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)));
}
