//! M3-T1 数据层：通用设置 KV / stats_range 按日聚合 / 完本目标字数 / 伏笔 CRUD。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::ForeshadowInput;
use bixian::state::AppState;
use bixian::stats;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn input(book_id: i64, title: &str, planted: i64, target: Option<i64>, note: &str) -> ForeshadowInput {
    ForeshadowInput {
        id: None,
        book_id,
        title: title.into(),
        planted_chapter_id: planted,
        target_chapter_id: target,
        note: note.into(),
        override_note: String::new(),
        repay_chapter_id: None,
    }
}

// ---- setting_get / setting_set ----

#[test]
fn settings_roundtrip_overwrite_and_missing() {
    let (_tmp, s) = setup();
    assert_eq!(cmd::setting_get_inner(&s, "nope").unwrap(), None, "不存在的 key 回 None");

    cmd::setting_set_inner(&s, "read:progress:1", "hello").unwrap();
    assert_eq!(cmd::setting_get_inner(&s, "read:progress:1").unwrap().as_deref(), Some("hello"));

    cmd::setting_set_inner(&s, "read:progress:1", "world").unwrap();
    assert_eq!(
        cmd::setting_get_inner(&s, "read:progress:1").unwrap().as_deref(),
        Some("world"),
        "同 key 再写覆盖"
    );
}

// ---- stats_range ----

#[test]
fn stats_range_empty_library_returns_empty() {
    let (_tmp, s) = setup();
    assert!(stats::range_inner(&s, 30, None).unwrap().is_empty());
    assert!(stats::range_inner(&s, 30, Some(1)).unwrap().is_empty());
}

#[test]
fn stats_range_aggregates_by_day_across_books_and_filters_by_book() {
    let (_tmp, s) = setup();
    let a = cmd::create_book_inner(&s, "甲").unwrap();
    let b = cmd::create_book_inner(&s, "乙").unwrap();
    stats::add_inner(&s, a.id, 100, true).unwrap();
    stats::add_inner(&s, a.id, 50, false).unwrap();
    stats::add_inner(&s, b.id, 25, false).unwrap();

    // book_id=None：跨书按日 SUM——今天一行 words=175、minutes=1
    let all = stats::range_inner(&s, 30, None).unwrap();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].date.len(), 10, "本地日期 YYYY-MM-DD: {}", all[0].date);
    assert_eq!(all[0].words, 175);
    assert_eq!(all[0].active_minutes, 1);

    // book_id=Some：只回该书
    let only_a = stats::range_inner(&s, 30, Some(a.id)).unwrap();
    assert_eq!(only_a.len(), 1);
    assert_eq!(only_a[0].words, 150);
    let only_b = stats::range_inner(&s, 30, Some(b.id)).unwrap();
    assert_eq!(only_b.len(), 1);
    assert_eq!(only_b[0].words, 25);
}

#[test]
fn stats_range_window_excludes_old_dates() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    stats::add_inner(&s, book.id, 10, false).unwrap();
    // add_inner 只会写"今天"，旧行直接 INSERT 构造（锁在块内放掉再查询）
    {
        let conn = s.db.lock().unwrap();
        conn.execute(
            "INSERT INTO writing_stats (date, book_id, words, active_minutes)
             VALUES (date('now','localtime','-60 days'), ?1, 999, 9)",
            [book.id],
        )
        .unwrap();
    }

    let window = stats::range_inner(&s, 30, None).unwrap();
    assert_eq!(window.len(), 1, "窗口外的旧日期不回");
    assert_eq!(window[0].words, 10);

    let wider = stats::range_inner(&s, 90, None).unwrap();
    assert_eq!(wider.len(), 2, "拉宽窗口后旧行回来");
    assert_eq!(wider[0].words, 999, "ORDER BY date ASC，旧行在前");
    assert_eq!(wider[1].words, 10);
}

// ---- books_set_target ----

#[test]
fn books_set_target_sets_clears_and_reads_back() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    assert_eq!(book.target_words, None, "新建书无目标");

    let set = cmd::books_set_target_inner(&s, book.id, Some(300000)).unwrap();
    assert_eq!(set.target_words, Some(300000), "返回更新后的书");
    assert_eq!(set.title, "书");
    assert_eq!(cmd::list_books_inner(&s).unwrap()[0].target_words, Some(300000));

    let cleared = cmd::books_set_target_inner(&s, book.id, None).unwrap();
    assert_eq!(cleared.target_words, None, "None 清空");
    assert_eq!(cmd::list_books_inner(&s).unwrap()[0].target_words, None);
}

#[test]
fn books_set_target_missing_book_is_not_found() {
    let (_tmp, s) = setup();
    let err = cmd::books_set_target_inner(&s, 999, Some(1)).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");
}

// ---- 伏笔全链 ----

#[test]
fn foreshadow_full_chain() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let c1 = cmd::create_chapter_inner(&s, book.id, "埋设章").unwrap();
    let c2 = cmd::create_chapter_inner(&s, book.id, "回收章").unwrap();

    assert!(cmd::foreshadows_list_inner(&s, book.id).unwrap().is_empty(), "初始为空");

    // 插入（id=None）
    let created = cmd::foreshadow_upsert_inner(
        &s,
        &input(book.id, "墙上的枪", c1.id, Some(c2.id), "第一幕挂在墙上"),
    )
    .unwrap();
    assert!(created.id > 0);
    assert_eq!(created.book_id, book.id);
    assert_eq!(created.title, "墙上的枪");
    assert_eq!(created.planted_chapter_id, c1.id);
    assert_eq!(created.target_chapter_id, Some(c2.id));
    assert_eq!(created.status, "active", "新登记默认 active");
    assert_eq!(created.note, "第一幕挂在墙上");
    assert!(!created.created_at.is_empty(), "created_at 由 DEFAULT 生成");
    assert_eq!(created.resolved_chapter_id, None);

    let list = cmd::foreshadows_list_inner(&s, book.id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, created.id);

    // 标记回收（带章 id）
    let resolved = cmd::foreshadow_set_status_inner(&s, created.id, "resolved", Some(c2.id)).unwrap();
    assert_eq!(resolved.status, "resolved");
    assert_eq!(resolved.resolved_chapter_id, Some(c2.id));

    // 非法状态
    let err = cmd::foreshadow_set_status_inner(&s, created.id, "done", None).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "实际: {err:?}");

    // resolved 不带章 id
    let err = cmd::foreshadow_set_status_inner(&s, created.id, "resolved", None).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "resolved 必须带回收章");

    // 回到 active：resolved_chapter_id 清 NULL
    let back = cmd::foreshadow_set_status_inner(&s, created.id, "active", Some(c2.id)).unwrap();
    assert_eq!(back.status, "active");
    assert_eq!(back.resolved_chapter_id, None, "非 resolved 状态清 NULL");

    // 更新（id=Some）：改标题与目标
    let mut upd = input(book.id, "改名后的枪", c1.id, None, "备注更新");
    upd.id = Some(created.id);
    let updated = cmd::foreshadow_upsert_inner(&s, &upd).unwrap();
    assert_eq!(updated.id, created.id, "更新不换行");
    assert_eq!(updated.title, "改名后的枪");
    assert_eq!(updated.target_chapter_id, None, "target 可改回未定");
    assert_eq!(updated.note, "备注更新");
    assert_eq!(cmd::foreshadows_list_inner(&s, book.id).unwrap().len(), 1, "仍是同一条");

    // 更新不存在的 id
    let mut ghost = input(book.id, "幽灵", c1.id, None, "");
    ghost.id = Some(9999);
    let err = cmd::foreshadow_upsert_inner(&s, &ghost).unwrap_err();
    assert!(matches!(err, AppError::NotFound(_)), "实际: {err:?}");

    // 删除
    cmd::foreshadow_delete_inner(&s, created.id).unwrap();
    assert!(cmd::foreshadows_list_inner(&s, book.id).unwrap().is_empty());
}

#[test]
fn foreshadow_blank_title_is_invalid() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let err = cmd::foreshadow_upsert_inner(&s, &input(book.id, "   ", 1, None, "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)), "空白标题拒绝");
}

#[test]
fn foreshadows_cascade_on_book_purge() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();
    cmd::foreshadow_upsert_inner(&s, &input(book.id, "伏", ch.id, None, "")).unwrap();

    // 软删书：行保留（书行还在，只是标了 deleted_at）
    cmd::delete_book_inner(&s, book.id).unwrap();
    assert_eq!(cmd::foreshadows_list_inner(&s, book.id).unwrap().len(), 1);

    // 彻底删除：书行 DELETE 经 FK 级联清空伏笔
    bixian::trash::purge_book_inner(&s, book.id).unwrap();
    assert!(cmd::foreshadows_list_inner(&s, book.id).unwrap().is_empty());
}
