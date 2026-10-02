//! 阶段 3A Binder 的数据侧保证：重排把顺序写进文件序号（Markdown 真源），
//! 删库重建索引后顺序不变；改名 / 重排时快照历史跟着走；撞名整批拒绝且不留半截状态。

use bixian::commands as cmd;
use bixian::models::ChapterMetaUpdate;
use bixian::state::AppState;

fn titles(s: &AppState, book_id: i64) -> Vec<String> {
    cmd::list_chapters_inner(s, book_id).unwrap().into_iter().map(|c| c.title).collect()
}

fn file_names(s: &AppState, book_id: i64) -> Vec<String> {
    cmd::list_chapters_inner(s, book_id)
        .unwrap()
        .into_iter()
        .map(|c| c.file_path.rsplit('/').next().unwrap().to_string())
        .collect()
}

#[test]
fn reorder_renumbers_files_and_survives_db_rebuild() {
    let tmp = tempfile::tempdir().unwrap();
    let (book_id, ids) = {
        let s = AppState::test_state(tmp.path());
        let book = cmd::create_book_inner(&s, "雪夜").unwrap();
        let mut ids = Vec::new();
        for t in ["甲", "乙", "丙", "丁", "戊"] {
            let c = cmd::create_chapter_inner(&s, book.id, t).unwrap();
            cmd::write_chapter_inner(&s, c.id, &format!("{t}章正文。")).unwrap();
            ids.push(c.id);
        }
        // 多选 丙丁戊 拖到首位
        cmd::reorder_chapters_inner(&s, &[ids[2], ids[3], ids[4], ids[0], ids[1]]).unwrap();
        assert_eq!(titles(&s, book.id), ["丙", "丁", "戊", "甲", "乙"]);
        assert_eq!(file_names(&s, book.id), ["0001-丙.md", "0002-丁.md", "0003-戊.md", "0004-甲.md", "0005-乙.md"]);
        // 磁盘：新路径有正文、manuscript 里没有多余文件
        for c in cmd::list_chapters_inner(&s, book.id).unwrap() {
            let body = std::fs::read_to_string(s.root.join(&c.file_path)).unwrap();
            assert_eq!(body, format!("{}章正文。", c.title));
        }
        let n = std::fs::read_dir(s.root.join(&book.slug).join("manuscript")).unwrap().count();
        assert_eq!(n, 5);
        // 移动后的章继续写，写到新路径
        cmd::write_chapter_inner(&s, ids[0], "甲章改稿。").unwrap();
        assert_eq!(cmd::read_chapter_inner(&s, ids[0]).unwrap().content, "甲章改稿。");
        (book.id, ids)
    };
    let _ = (book_id, ids);
    // 删库：只剩 Markdown，重建索引后顺序与正文都在
    std::fs::remove_file(tmp.path().join("bixian.db")).unwrap();
    let s = AppState::test_state(tmp.path());
    cmd::rescan_library_inner(&s).unwrap();
    let book = cmd::list_books_inner(&s).unwrap().remove(0);
    assert_eq!(titles(&s, book.id), ["丙", "丁", "戊", "甲", "乙"]);
    let first = cmd::list_chapters_inner(&s, book.id).unwrap().remove(3);
    assert_eq!(cmd::read_chapter_inner(&s, first.id).unwrap().content, "甲章改稿。");
}

#[test]
fn reorder_swaps_chapters_with_same_title() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let a = cmd::create_chapter_inner(&s, book.id, "无题").unwrap();
    let b = cmd::create_chapter_inner(&s, book.id, "无题").unwrap();
    cmd::write_chapter_inner(&s, a.id, "甲").unwrap();
    cmd::write_chapter_inner(&s, b.id, "乙").unwrap();
    cmd::reorder_chapters_inner(&s, &[b.id, a.id]).unwrap();
    assert_eq!(file_names(&s, book.id), ["0001-无题.md", "0002-无题.md"]);
    assert_eq!(cmd::read_chapter_inner(&s, b.id).unwrap().content, "乙");
    assert_eq!(cmd::read_chapter_inner(&s, a.id).unwrap().content, "甲");
    assert!(cmd::read_chapter_inner(&s, b.id).unwrap().meta.file_path.ends_with("0001-无题.md"));
}

#[test]
fn history_follows_rename_and_reorder() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let a = cmd::create_chapter_inner(&s, book.id, "开端").unwrap();
    let b = cmd::create_chapter_inner(&s, book.id, "发展").unwrap();
    cmd::write_chapter_inner(&s, b.id, "第一版正文，足够长的一段话。").unwrap();
    assert_eq!(cmd::list_history_inner(&s, b.id).unwrap().len(), 1);

    cmd::rename_chapter_inner(&s, b.id, "转折").unwrap();
    assert_eq!(cmd::list_history_inner(&s, b.id).unwrap().len(), 1, "改名后历史仍在");

    cmd::reorder_chapters_inner(&s, &[b.id, a.id]).unwrap();
    let h = cmd::list_history_inner(&s, b.id).unwrap();
    assert_eq!(h.len(), 1, "重排改序号后历史仍在");
    assert_eq!(cmd::read_history_inner(&s, b.id, &h[0].file).unwrap(), "第一版正文，足够长的一段话。");
    assert!(cmd::list_history_inner(&s, a.id).unwrap().is_empty());
}

#[test]
fn reorder_conflict_rejected_without_partial_state() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let a = cmd::create_chapter_inner(&s, book.id, "甲").unwrap();
    let b = cmd::create_chapter_inner(&s, book.id, "乙").unwrap();
    // 用户手动放进 manuscript 的同名文件占住了重排目标位
    let stray = s.root.join(&book.slug).join("manuscript").join("0001-乙.md");
    std::fs::write(&stray, "别人的文件").unwrap();
    assert!(cmd::reorder_chapters_inner(&s, &[b.id, a.id]).is_err());
    assert_eq!(titles(&s, book.id), ["甲", "乙"], "DB 顺序回滚");
    assert_eq!(file_names(&s, book.id), ["0001-甲.md", "0002-乙.md"]);
    assert!(s.root.join(&a.file_path).exists() && s.root.join(&b.file_path).exists());
    assert_eq!(std::fs::read_to_string(&stray).unwrap(), "别人的文件");
}

#[test]
fn restore_after_reorder_renumbers_without_collision() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let a = cmd::create_chapter_inner(&s, book.id, "甲").unwrap();
    let b = cmd::create_chapter_inner(&s, book.id, "乙").unwrap();
    let c = cmd::create_chapter_inner(&s, book.id, "丙").unwrap();
    cmd::delete_chapter_inner(&s, a.id).unwrap();
    cmd::reorder_chapters_inner(&s, &[c.id, b.id]).unwrap();
    assert_eq!(file_names(&s, book.id), ["0001-丙.md", "0002-乙.md"]);
    // 甲 原路径 0001-甲.md 与 丙 撞号：恢复后整本书重编，文件名序 = 目录序
    bixian::trash::restore_chapter_inner(&s, a.id).unwrap();
    let names = file_names(&s, book.id);
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted, "文件名排序与目录序一致");
    assert_eq!(names.len(), 3);
}

#[test]
fn batch_meta_assignment_touches_only_given_chapters() {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ids: Vec<i64> = ["一", "二", "三"].iter().map(|t| cmd::create_chapter_inner(&s, book.id, t).unwrap().id).collect();
    let label = cmd::labels_list_inner(&s, book.id).unwrap().remove(0);
    let upd = ChapterMetaUpdate { label_id: Some(Some(label.id)), ..Default::default() };
    for id in &ids[..2] {
        cmd::chapter_update_meta_inner(&s, *id, &upd).unwrap();
    }
    let chs = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(chs.iter().map(|c| c.label_id).collect::<Vec<_>>(), [Some(label.id), Some(label.id), None]);
    // 元数据不是正文变更：文件序号与路径不动
    assert_eq!(file_names(&s, book.id), ["0001-一.md", "0002-二.md", "0003-三.md"]);
}
