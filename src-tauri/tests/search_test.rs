use bixian::commands as cmd;
use bixian::search::{search_book_inner, search_content, MAX_HITS};
use bixian::state::AppState;
use bixian::trash;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

/// 建书 + 逐章写正文，返回 (state 持有者, 书 id, 章 id 列表)
fn book_with(s: &AppState, chapters: &[(&str, &str)]) -> (i64, Vec<i64>) {
    let book = cmd::create_book_inner(s, "书").unwrap();
    let ids = chapters
        .iter()
        .map(|(title, body)| {
            let c = cmd::create_chapter_inner(s, book.id, title).unwrap();
            cmd::write_chapter_inner(s, c.id, body).unwrap();
            c.id
        })
        .collect();
    (book.id, ids)
}

// ---- 纯函数：匹配规则 ----

#[test]
fn finds_all_occurrences_in_a_line_with_offsets() {
    let hits = search_content(1, "一", "风雪很大，风雪又起。", "风雪", false);
    assert_eq!(hits.len(), 2);
    assert_eq!((hits[0].line_no, hits[0].match_start, hits[0].match_end), (1, 0, 2));
    assert_eq!((hits[1].match_start, hits[1].match_end), (5, 7), "字符索引，含标点");
    assert_eq!(hits[0].line_text, "风雪很大，风雪又起。");
}

#[test]
fn case_insensitive_for_latin() {
    let hits = search_content(1, "一", "The Snow and the SNOW.", "snow", false);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[1].match_start, 17);
}

#[test]
fn whole_word_requires_non_word_boundaries() {
    let line = "snow snowman snow";
    assert_eq!(search_content(1, "一", line, "snow", false).len(), 3);

    let whole = search_content(1, "一", line, "snow", true);
    assert_eq!(whole.len(), 2, "snowman 里的 snow 不算整词");
    assert_eq!(whole[0].match_start, 0);
    assert_eq!(whole[1].match_start, 13);

    // CJK 同样按词字符处理：「风雪」在「风雪夜」中不是整词
    assert!(search_content(1, "一", "风雪夜归人", "风雪", true).is_empty());
    assert_eq!(search_content(1, "一", "风雪，夜归人", "风雪", true).len(), 1);
}

#[test]
fn empty_or_missing_query_yields_nothing() {
    assert!(search_content(1, "一", "正文。", "", false).is_empty());
    assert!(search_content(1, "一", "正文。", "没有的词", false).is_empty());
}

#[test]
fn line_numbers_are_one_based() {
    let hits = search_content(1, "一", "第一行。\n第二行有风雪。\n第三行。", "风雪", false);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].line_no, 2);
}

// ---- 全书搜索 ----

#[test]
fn searches_across_chapters_in_book_order() {
    let (_tmp, s) = setup();
    let (book_id, ids) = book_with(&s, &[("一", "风雪很大。"), ("二", "又是风雪。"), ("三", "无关。")]);

    let r = search_book_inner(&s, book_id, "风雪", false).unwrap();
    assert_eq!(r.hits.len(), 2);
    assert!(!r.truncated);
    assert_eq!(r.hits[0].chapter_id, ids[0]);
    assert_eq!(r.hits[0].chapter_title, "一");
    assert_eq!(r.hits[1].chapter_id, ids[1]);
    assert_eq!(r.hits[1].chapter_title, "二");
}

#[test]
fn excludes_soft_deleted_chapters() {
    let (_tmp, s) = setup();
    let (book_id, ids) = book_with(&s, &[("一", "风雪很大。"), ("二", "又是风雪。")]);

    cmd::delete_chapter_inner(&s, ids[0]).unwrap();

    let r = search_book_inner(&s, book_id, "风雪", false).unwrap();
    assert_eq!(r.hits.len(), 1, "回收站里的章不参与搜索");
    assert_eq!(r.hits[0].chapter_id, ids[1]);

    // 恢复后重新可搜
    trash::restore_chapter_inner(&s, ids[0]).unwrap();
    assert_eq!(search_book_inner(&s, book_id, "风雪", false).unwrap().hits.len(), 2);
}

#[test]
fn blank_query_returns_empty_result() {
    let (_tmp, s) = setup();
    let (book_id, _) = book_with(&s, &[("一", "风雪很大。")]);
    let r = search_book_inner(&s, book_id, "   ", false).unwrap();
    assert!(r.hits.is_empty());
    assert!(!r.truncated);
}

#[test]
fn caps_hits_and_flags_truncation() {
    let (_tmp, s) = setup();
    let body = "啊".repeat(MAX_HITS + 50);
    let (book_id, _) = book_with(&s, &[("一", &body)]);

    let r = search_book_inner(&s, book_id, "啊", false).unwrap();
    assert_eq!(r.hits.len(), MAX_HITS, "命中数封顶");
    assert!(r.truncated, "截断要显式告知前端，不能静默");

    // 未达上限时不标记截断
    let (_tmp2, s2) = setup();
    let (book2, _) = book_with(&s2, &[("一", "啊")]);
    let r2 = search_book_inner(&s2, book2, "啊", false).unwrap();
    assert_eq!(r2.hits.len(), 1);
    assert!(!r2.truncated);
}
