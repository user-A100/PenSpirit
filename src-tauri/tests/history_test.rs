use bixian::commands as cmd;
use bixian::history::{self, SnapshotMode};
use bixian::state::AppState;
use bixian::util::count_words;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

/// 递增的本地时间戳（测试用确定性序列，格式与 SQLite localtime 一致）
fn ts(i: usize) -> String {
    format!("2026-09-19 10:{:02}:{:02}", i / 60, i % 60)
}

/// 快照文件名规则：{时间戳下划线化}_{字数}.md
fn expected_file(i: usize, content: &str) -> String {
    format!("{}_{}.md", ts(i).replace(' ', "-").replace(':', "-"), count_words(content))
}

fn md_files_in(dir: &std::path::Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .unwrap()
        .flatten()
        .map(|e| e.file_name().to_string_lossy().to_string())
        .filter(|n| n.ends_with(".md"))
        .collect();
    v.sort();
    v
}

// ---- 存储与索引语义（用 Force 隔离分桶，专测落盘行为） ----

#[test]
fn first_snapshot_writes_file_and_index() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");

    assert!(history::snapshot(&dir, "0001-yi", "一", "初见正文。", &ts(0), SnapshotMode::Force));

    let list = history::list_snapshots(&dir, "0001-yi");
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].ts, "2026-09-19 10:00:00");
    assert_eq!(list[0].title, "一");
    assert_eq!(list[0].words, 4, "CJK 逐字计，标点不计");
    assert_eq!(list[0].file, expected_file(0, "初见正文。"));
    assert_eq!(
        std::fs::read_to_string(dir.join(".history/0001-yi").join(&list[0].file)).unwrap(),
        "初见正文。"
    );
}

#[test]
fn identical_content_not_duplicated() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    let snap = |c: &str, t: &str| history::snapshot(&dir, "0001-yi", "一", c, t, SnapshotMode::Force);

    assert!(snap("正文一。\n正文二。", &ts(0)));
    assert!(!snap("正文一。\n正文二。", &ts(1)), "完全相同");
    assert!(!snap("正文一。  \r\n正文二。\r\n\r\n\r\n", &ts(2)), "仅 CRLF/行尾空白/连续空行差异");
    assert!(snap("正文一。\n正文二改。", &ts(3)), "实质改动");

    let list = history::list_snapshots(&dir, "0001-yi");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].ts, "2026-09-19 10:00:03", "新→旧");
    assert_eq!(list[1].ts, "2026-09-19 10:00:00");
}

#[test]
fn empty_content_skipped() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    assert!(!history::snapshot(&dir, "0001-yi", "一", "", &ts(0), SnapshotMode::Force));
    assert!(!history::snapshot(&dir, "0001-yi", "一", "   \n\n \t ", &ts(1), SnapshotMode::Force));
    assert!(history::list_snapshots(&dir, "0001-yi").is_empty());
}

#[test]
fn rolling_keeps_max_and_purges_oldest_files() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");

    for i in 0..(history::MAX_SNAPSHOTS + 3) {
        assert!(history::snapshot(&dir, "0001-yi", "一", &format!("第 {i} 稿。"), &ts(i), SnapshotMode::Force));
    }

    let list = history::list_snapshots(&dir, "0001-yi");
    assert_eq!(list.len(), history::MAX_SNAPSHOTS, "滚动上限");
    assert_eq!(list[0].ts, ts(history::MAX_SNAPSHOTS + 2), "最新在最前");
    assert_eq!(list.last().unwrap().ts, ts(3), "最旧的 0/1/2 已被滚出");
    assert_eq!(
        md_files_in(&dir.join(".history/0001-yi")).len(),
        history::MAX_SNAPSHOTS,
        "被滚出的快照文件同步删除，目录不留孤儿"
    );
}

#[test]
fn index_matches_files_on_disk() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    let contents: Vec<String> = (0..5).map(|i| format!("第 {i} 稿。")).collect();
    for (i, c) in contents.iter().enumerate() {
        history::snapshot(&dir, "0001-yi", "一", c, &ts(i), SnapshotMode::Force);
    }

    let snap_dir = dir.join(".history/0001-yi");
    let mut indexed: Vec<String> =
        history::list_snapshots(&dir, "0001-yi").into_iter().map(|s| s.file).collect();
    indexed.sort();
    assert_eq!(indexed, md_files_in(&snap_dir), "index.json 与目录内 .md 一一对应");
    assert_eq!(indexed, (0..5).map(|i| expected_file(i, &contents[i])).collect::<Vec<_>>());
}

#[test]
fn chapters_are_isolated() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");

    history::snapshot(&dir, "0001-yi", "一", "第一章正文。", &ts(0), SnapshotMode::Force);
    history::snapshot(&dir, "0002-er", "二", "第二章正文。", &ts(1), SnapshotMode::Force);

    assert_eq!(history::list_snapshots(&dir, "0001-yi").len(), 1);
    assert_eq!(history::list_snapshots(&dir, "0002-er").len(), 1);
    let a = history::read_snapshot(&dir, "0001-yi", &expected_file(0, "第一章正文。")).unwrap();
    assert_eq!(a, "第一章正文。");
    let b = history::read_snapshot(&dir, "0002-er", &expected_file(1, "第二章正文。")).unwrap();
    assert_eq!(b, "第二章正文。");
}

#[test]
fn read_snapshot_rejects_traversal_and_missing() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    history::snapshot(&dir, "0001-yi", "一", "正文。", &ts(0), SnapshotMode::Force);
    let good = expected_file(0, "正文。");

    assert!(history::read_snapshot(&dir, "0001-yi", "../index.json").is_err());
    assert!(history::read_snapshot(&dir, "0001-yi", "..").is_err());
    assert!(history::read_snapshot(&dir, "0001-yi", "nope.md").is_err());
    assert!(history::read_snapshot(&dir, "0001-yi", "a/b.md").is_err());
    assert!(history::read_snapshot(&dir, "../../etc", &good).is_err());
    assert_eq!(history::read_snapshot(&dir, "0001-yi", &good).unwrap(), "正文。");
}

// ---- 时间分桶（Auto）与豁免 ----

#[test]
fn auto_buckets_within_interval() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    let snap = |c: &str, t: &str| history::snapshot(&dir, "0001-yi", "一", c, t, SnapshotMode::Auto);

    assert!(snap("一稿。", &ts(0)));
    assert!(!snap("二稿。", "2026-09-19 10:04:59"), "未满 5 分钟不占槽位");
    assert!(snap("三稿。", "2026-09-19 10:05:00"), "满 5 分钟入历史");
    assert_eq!(history::list_snapshots(&dir, "0001-yi").len(), 2);
}

#[test]
fn auto_writes_on_big_change_within_interval() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    let snap = |c: &str, t: &str| history::snapshot(&dir, "0001-yi", "一", c, t, SnapshotMode::Auto);

    assert!(snap("短短一行。", &ts(0)));
    assert!(!snap("短短一行改。", &ts(1)), "小幅改动仍在桶内");
    // AI 采纳 / 大段粘贴：字数跳变超过阈值 → 豁免，立即入历史
    let long = format!("短短一行。{}", "追加".repeat(120));
    assert!(count_words(&long) - count_words("短短一行。") >= history::BIG_CHANGE_WORDS);
    assert!(snap(&long, &ts(2)), "大幅改动无视分桶");
    assert_eq!(history::list_snapshots(&dir, "0001-yi").len(), 2);
}

#[test]
fn force_ignores_interval() {
    let (_tmp, s) = setup();
    let dir = s.root.join("shu");
    assert!(history::snapshot(&dir, "0001-yi", "一", "一稿。", &ts(0), SnapshotMode::Force));
    assert!(
        history::snapshot(&dir, "0001-yi", "一", "二稿。", &ts(1), SnapshotMode::Force),
        "恢复前的保险快照必须落版，否则该次恢复不可逆"
    );
    assert_eq!(history::list_snapshots(&dir, "0001-yi").len(), 2);
}

#[test]
fn seconds_between_handles_calendar_boundaries() {
    let d = |a: &str, b: &str| history::seconds_between(a, b);
    assert_eq!(d("2026-09-19 10:00:00", "2026-09-19 10:05:00"), Some(300));
    assert_eq!(d("2026-09-19 23:59:30", "2026-09-20 00:00:30"), Some(60), "跨日");
    assert_eq!(d("2026-12-31 23:59:00", "2027-01-01 00:01:00"), Some(120), "跨年");
    assert_eq!(d("2024-02-28 23:59:00", "2024-02-29 00:00:00"), Some(60), "闰年 2/29");
    assert_eq!(d("2023-02-28 23:59:00", "2023-03-01 00:00:00"), Some(60), "平年 2/28→3/1");
    assert_eq!(d("2026-09-19 10:00:00", "不是时间戳"), None);
    assert_eq!(d("2026-9-19 10:00:00", "2026-09-19 10:00:01"), None);
}

// ---- 与 write_chapter 的接线 ----

#[test]
fn write_chapter_snapshots_first_save_then_respects_bucket() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();

    cmd::write_chapter_inner(&s, ch.id, "一稿正文。").unwrap();
    let list = cmd::list_history_inner(&s, ch.id).unwrap();
    assert_eq!(list.len(), 1, "首版立即入历史");
    assert_eq!(list[0].title, "一");
    assert_eq!(list[0].words, count_words("一稿正文。"));
    assert!(list[0].file.ends_with(&format!("_{}.md", count_words("一稿正文。"))));

    // 同一时段内的自动保存不占槽位；反复落同一内容同样不重复
    cmd::write_chapter_inner(&s, ch.id, "二稿正文。").unwrap();
    cmd::write_chapter_inner(&s, ch.id, "二稿正文。").unwrap();
    assert_eq!(cmd::list_history_inner(&s, ch.id).unwrap().len(), 1, "5 分钟内的改动合为一版");

    // 恢复旧版前的保险快照用 Force，无视分桶
    assert!(cmd::snapshot_now_inner(&s, ch.id, "三稿，尚未自动保存。").unwrap());
    let list = cmd::list_history_inner(&s, ch.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].words, count_words("三稿，尚未自动保存。"));
    assert!(!cmd::snapshot_now_inner(&s, ch.id, "三稿，尚未自动保存。").unwrap(), "同内容 no-op");

    // 旧版正文可读回
    let oldest = cmd::list_history_inner(&s, ch.id).unwrap().pop().unwrap();
    assert_eq!(cmd::read_history_inner(&s, ch.id, &oldest.file).unwrap(), "一稿正文。");
}
