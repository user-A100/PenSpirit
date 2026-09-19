use bixian::commands as cmd;
use bixian::sensitive::{self, CONTEXT_CHARS};
use bixian::state::AppState;
use bixian::stats;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn words(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

// ---- 写作统计 ----

#[test]
fn today_starts_at_zero_with_todays_date() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();

    let t = stats::today_inner(&s, book.id).unwrap();
    assert_eq!(t.words, 0);
    assert_eq!(t.active_minutes, 0);
    assert_eq!(t.date.len(), 10, "本地日期 YYYY-MM-DD: {}", t.date);
}

#[test]
fn add_accumulates_and_can_go_negative() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();

    stats::add_inner(&s, book.id, 120, false).unwrap();
    stats::add_inner(&s, book.id, 80, false).unwrap();
    assert_eq!(stats::today_inner(&s, book.id).unwrap().words, 200);

    // 删改会减
    stats::add_inner(&s, book.id, -30, false).unwrap();
    assert_eq!(stats::today_inner(&s, book.id).unwrap().words, 170);
    // 减到负也如实记录（不夹到 0——不然"今天写的"会虚高）
    stats::add_inner(&s, book.id, -500, false).unwrap();
    assert_eq!(stats::today_inner(&s, book.id).unwrap().words, -330);
}

#[test]
fn active_minutes_only_count_when_flagged() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();

    stats::add_inner(&s, book.id, 10, true).unwrap();
    stats::add_inner(&s, book.id, 10, false).unwrap();
    stats::add_inner(&s, book.id, 10, false).unwrap();
    stats::add_inner(&s, book.id, 10, true).unwrap();

    let t = stats::today_inner(&s, book.id).unwrap();
    assert_eq!(t.words, 40);
    assert_eq!(t.active_minutes, 2, "同一分钟内的后续调用不再计次");
}

#[test]
fn same_day_same_book_stays_one_row() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    for _ in 0..5 {
        stats::add_inner(&s, book.id, 7, false).unwrap();
    }
    // 注意：先在块里放掉连接锁再调 today_inner——AppState 的 Mutex 不可重入
    let rows: i64 = {
        let conn = s.db.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM writing_stats WHERE book_id = ?1", [book.id], |r| r.get(0))
            .unwrap()
    };
    assert_eq!(rows, 1, "upsert 到同一行");
    assert_eq!(stats::today_inner(&s, book.id).unwrap().words, 35);
}

#[test]
fn stats_are_per_book() {
    let (_tmp, s) = setup();
    let a = cmd::create_book_inner(&s, "甲").unwrap();
    let b = cmd::create_book_inner(&s, "乙").unwrap();

    stats::add_inner(&s, a.id, 100, true).unwrap();
    stats::add_inner(&s, b.id, 25, false).unwrap();

    assert_eq!(stats::today_inner(&s, a.id).unwrap().words, 100);
    assert_eq!(stats::today_inner(&s, b.id).unwrap().words, 25);
    assert_eq!(stats::today_inner(&s, a.id).unwrap().active_minutes, 1);
    assert_eq!(stats::today_inner(&s, b.id).unwrap().active_minutes, 0);
}

#[test]
fn purging_a_book_removes_its_stats() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    stats::add_inner(&s, book.id, 100, false).unwrap();

    // 软删不改统计；彻底删除经 FK 级联清掉
    cmd::delete_book_inner(&s, book.id).unwrap();
    assert_eq!(stats::today_inner(&s, book.id).unwrap().words, 100);
    bixian::trash::purge_book_inner(&s, book.id).unwrap();

    let conn = s.db.lock().unwrap();
    let rows: i64 = conn
        .query_row("SELECT COUNT(*) FROM writing_stats WHERE book_id = ?1", [book.id], |r| r.get(0))
        .unwrap();
    assert_eq!(rows, 0);
}

// ---- 敏感词扫描 ----

#[test]
fn reports_multiple_hits_with_context() {
    let text = "他走进雨夜，雨夜很长。";
    let hits = sensitive::scan(text, &words(&["雨夜"]));
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].word, "雨夜");
    assert_eq!(hits[0].byte_start, "他走进".len(), "字节偏移");
    assert!(hits[0].context.starts_with("他走进雨夜"));
}

#[test]
fn reports_overlapping_words_without_swallowing() {
    // 「蝴蝶」与「蝶花」在「蝴蝶花」上重叠——两个都要报，不能被前一个吃掉
    let hits = sensitive::scan("蝴蝶花开了", &words(&["蝴蝶", "蝶花"]));
    let found: Vec<&str> = hits.iter().map(|h| h.word.as_str()).collect();
    assert_eq!(hits.len(), 2, "重叠命中都报: {found:?}");
    assert!(found.contains(&"蝴蝶"));
    assert!(found.contains(&"蝶花"));
}

#[test]
fn context_is_char_bounded_and_multibyte_safe() {
    let text = format!("{}{}{}", "前".repeat(50), "敏感", "后".repeat(50));
    let hits = sensitive::scan(&text, &words(&["敏感"]));
    assert_eq!(hits.len(), 1);
    // 命中在正中间，前后都够 20 字，取满后不 panic（按字符切而非字节）
    assert_eq!(hits[0].context.chars().count(), CONTEXT_CHARS + 2 + CONTEXT_CHARS);
    assert!(hits[0].context.starts_with(&"前".repeat(CONTEXT_CHARS)));
    assert!(hits[0].context.ends_with(&"后".repeat(CONTEXT_CHARS)));
}

#[test]
fn context_clamps_at_text_edges() {
    let hits = sensitive::scan("敏感词", &words(&["敏感"]));
    assert_eq!(hits[0].context, "敏感词", "开头命中时前文为空");
}

#[test]
fn empty_word_bank_or_blank_words_yield_nothing() {
    assert!(sensitive::scan("敏感内容", &[]).is_empty());
    assert!(sensitive::scan("敏感内容", &words(&["  ", ""])).is_empty());
    assert!(sensitive::scan("", &words(&["敏感"])).is_empty());
}

#[test]
fn parse_word_lines_skips_blanks_comments_and_dupes() {
    let parsed = sensitive::parse_word_lines("暴力\n\n  # 注释不该进词库\n暴力\n色情 \n  \n");
    assert_eq!(parsed, words(&["暴力", "色情"]), "去空行/注释/重复，保留首次顺序");
}

#[test]
fn word_bank_round_trips_through_settings() {
    let (_tmp, s) = setup();
    assert!(sensitive::get_words_inner(&s).unwrap().is_empty(), "初始为空");

    let saved = sensitive::set_words_inner(&s, &words(&["暴力", "  ", "暴力", "色情"])).unwrap();
    assert_eq!(saved, words(&["暴力", "色情"]), "保存时就清洗");
    assert_eq!(sensitive::get_words_inner(&s).unwrap(), saved, "落库可读回");

    // 用已存词库扫描
    let hits = sensitive::scan_inner(&s, "这里有色情内容").unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].word, "色情");

    sensitive::set_words_inner(&s, &[]).unwrap();
    assert!(sensitive::scan_inner(&s, "这里有色情内容").unwrap().is_empty());
}
