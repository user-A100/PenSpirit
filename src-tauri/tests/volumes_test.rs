//! 阶段 3B：卷 / 文件夹层级。卷 = manuscript/ 下一层子目录，卷与章共用一条全书序号；
//! 验证磁盘与 DB 始终一致（按文件名排序 = 全书先序）、删库可由磁盘重建层级、
//! 跨卷移动 / 改名 / 回收站 / 导入导出 / AI 前情 / 拆分合并。

use std::collections::HashMap;

use bixian::commands as cmd;
use bixian::commands_ai as ai;
use bixian::models::{AiTurnOptions, ChapterMeta, TreeItem};
use bixian::porting::export::{build_txt, ExportRange};
use bixian::porting::import::{import_chapters_inner, ParsedChapter};
use bixian::state::AppState;
use bixian::trash;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let s = AppState::test_state(tmp.path());
    (tmp, s)
}

fn nodes(s: &AppState, book_id: i64) -> Vec<ChapterMeta> {
    cmd::list_nodes_inner(s, book_id).unwrap()
}

/// DB 视角的树：manuscript/ 之后的相对路径（卷带尾斜杠），按全书先序
fn db_tree(s: &AppState, book_id: i64) -> Vec<String> {
    nodes(s, book_id)
        .iter()
        .map(|n| {
            let rel = n.file_path.split_once("/manuscript/").unwrap().1.to_string();
            if n.kind == "folder" { format!("{rel}/") } else { rel }
        })
        .collect()
}

/// 磁盘视角的树：按文件名排序遍历 manuscript/（一层子目录），跳过隐藏项与卷首语
fn disk_tree(s: &AppState, slug: &str) -> Vec<String> {
    let ms = s.root.join(slug).join("manuscript");
    let names = |p: &std::path::Path| {
        let mut v: Vec<String> = std::fs::read_dir(p)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| !n.starts_with('.') && n != "_index.md")
            .collect();
        v.sort();
        v
    };
    let mut out = Vec::new();
    for n in names(&ms) {
        if ms.join(&n).is_dir() {
            out.push(format!("{n}/"));
            for k in names(&ms.join(&n)) {
                out.push(format!("{n}/{k}"));
            }
        } else {
            out.push(n);
        }
    }
    out
}

fn assert_consistent(s: &AppState, book_id: i64, slug: &str) {
    assert_eq!(db_tree(s, book_id), disk_tree(s, slug), "磁盘按文件名排序 = DB 全书先序");
}

/// (标题, 所属卷标题) 按全书先序
fn shape(s: &AppState, book_id: i64) -> Vec<(String, Option<String>)> {
    let ns = nodes(s, book_id);
    let title: HashMap<i64, String> = ns.iter().map(|n| (n.id, n.title.clone())).collect();
    ns.iter().map(|n| (n.title.clone(), n.parent_id.map(|p| title[&p].clone()))).collect()
}

fn sh(items: &[(&str, Option<&str>)]) -> Vec<(String, Option<String>)> {
    items.iter().map(|(t, p)| (t.to_string(), p.map(String::from))).collect()
}

struct Sample {
    book_id: i64,
    slug: String,
    id: HashMap<&'static str, i64>,
}

/// 序章 / 第一卷[甲, 乙] / 第二卷[丙] / 尾声，正文 = 「X的正文。」
fn sample(s: &AppState) -> Sample {
    let book = cmd::create_book_inner(s, "雪夜渡").unwrap();
    let mut id = HashMap::new();
    for t in ["序章", "甲", "乙", "丙", "尾声"] {
        let c = cmd::create_chapter_inner(s, book.id, t).unwrap();
        cmd::write_chapter_inner(s, c.id, &format!("{t}的正文。")).unwrap();
        id.insert(t, c.id);
    }
    let v1 = cmd::volume_create_inner(s, book.id, "第一卷", None, &[id["甲"], id["乙"]]).unwrap();
    let v2 = cmd::volume_create_inner(s, book.id, "第二卷", None, &[id["丙"]]).unwrap();
    id.insert("第一卷", v1.id);
    id.insert("第二卷", v2.id);
    Sample { book_id: book.id, slug: book.slug, id }
}

fn item(id: i64, parent: Option<i64>) -> TreeItem {
    TreeItem { id, parent_id: parent }
}

#[test]
fn volumes_are_subdirectories_with_book_wide_numbering() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    assert_eq!(
        db_tree(&s, sm.book_id),
        [
            "0001-序章.md",
            "0002-第一卷/",
            "0002-第一卷/0003-甲.md",
            "0002-第一卷/0004-乙.md",
            "0005-第二卷/",
            "0005-第二卷/0006-丙.md",
            "0007-尾声.md"
        ]
    );
    assert_consistent(&s, sm.book_id, &sm.slug);
    // list_chapters 只给正文章、全书先序（搜索 / 导出 / AI 前情等调用方语义不变）
    let titles: Vec<String> = cmd::list_chapters_inner(&s, sm.book_id).unwrap().into_iter().map(|c| c.title).collect();
    assert_eq!(titles, ["序章", "甲", "乙", "丙", "尾声"]);
    // 正文随文件搬进卷目录
    assert_eq!(cmd::read_chapter_inner(&s, sm.id["乙"]).unwrap().content, "乙的正文。");
}

#[test]
fn rescan_rebuilds_hierarchy_after_db_loss() {
    let tmp = tempfile::tempdir().unwrap();
    let expected = {
        let s = AppState::test_state(tmp.path());
        let sm = sample(&s);
        shape(&s, sm.book_id)
    };
    std::fs::remove_file(tmp.path().join("bixian.db")).unwrap();
    let s = AppState::test_state(tmp.path());
    assert_eq!(cmd::rescan_library_inner(&s).unwrap(), 5, "只数正文章");
    let book = cmd::list_books_inner(&s).unwrap().remove(0);
    assert_eq!(shape(&s, book.id), expected, "卷与章的层级、顺序都由磁盘重建");
    let bing = cmd::list_chapters_inner(&s, book.id).unwrap().into_iter().find(|c| c.title == "丙").unwrap();
    assert_eq!(cmd::read_chapter_inner(&s, bing.id).unwrap().content, "丙的正文。");
    // 幂等
    cmd::rescan_library_inner(&s).unwrap();
    assert_eq!(shape(&s, book.id), expected);
}

#[test]
fn cross_volume_move_keeps_disk_db_and_history_in_sync() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    assert_eq!(cmd::list_history_inner(&s, id["乙"]).unwrap().len(), 1);
    // 乙 从第一卷拖到第二卷、丙 之前
    let items = [
        item(id["序章"], None),
        item(id["第一卷"], None),
        item(id["甲"], Some(id["第一卷"])),
        item(id["第二卷"], None),
        item(id["乙"], Some(id["第二卷"])),
        item(id["丙"], Some(id["第二卷"])),
        item(id["尾声"], None),
    ];
    cmd::tree_apply_inner(&s, sm.book_id, &items).unwrap();
    assert_eq!(
        db_tree(&s, sm.book_id),
        [
            "0001-序章.md",
            "0002-第一卷/",
            "0002-第一卷/0003-甲.md",
            "0004-第二卷/",
            "0004-第二卷/0005-乙.md",
            "0004-第二卷/0006-丙.md",
            "0007-尾声.md"
        ]
    );
    assert_consistent(&s, sm.book_id, &sm.slug);
    assert_eq!(cmd::read_chapter_inner(&s, id["乙"]).unwrap().content, "乙的正文。");
    assert_eq!(cmd::list_history_inner(&s, id["乙"]).unwrap().len(), 1, "快照历史随文件主干迁移");
    // AI 前情：丙 的上一章 = 全书序前一章 乙（同卷），乙 的上一章 = 甲（跨卷）
    let session = ai::get_or_create_session_inner(&s, id["乙"]).unwrap();
    let log = ai::preview_context_inner(&s, session.id, "继续", &AiTurnOptions::default()).unwrap();
    let prev = log.slots.iter().find(|x| x.name == "上一章结尾").expect("有上一章结尾");
    assert!(prev.preview_head.contains("甲的正文"), "跨卷取全书序前一章：{}", prev.preview_head);
}

#[test]
fn tree_apply_rejects_invalid_structures_without_side_effects() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    let before = db_tree(&s, sm.book_id);
    let bad: Vec<Vec<TreeItem>> = vec![
        // 卷放进卷
        vec![item(id["序章"], None), item(id["第一卷"], None), item(id["甲"], Some(id["第一卷"])), item(id["乙"], Some(id["第一卷"])), item(id["第二卷"], Some(id["第一卷"])), item(id["丙"], None), item(id["尾声"], None)],
        // 卷内的章没紧跟所属卷
        vec![item(id["序章"], None), item(id["第一卷"], None), item(id["甲"], Some(id["第一卷"])), item(id["尾声"], None), item(id["乙"], Some(id["第一卷"])), item(id["第二卷"], None), item(id["丙"], Some(id["第二卷"]))],
        // 漏节点
        vec![item(id["序章"], None)],
    ];
    for items in bad {
        assert!(cmd::tree_apply_inner(&s, sm.book_id, &items).is_err());
    }
    assert_eq!(db_tree(&s, sm.book_id), before);
    assert_consistent(&s, sm.book_id, &sm.slug);
}

#[test]
fn create_chapter_at_follows_placement_rules() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    // 在卷内章之后 → 同卷其后
    cmd::create_chapter_at_inner(&s, sm.book_id, "甲二", Some(id["甲"]), None).unwrap();
    // 只给卷 → 卷末
    cmd::create_chapter_at_inner(&s, sm.book_id, "丙二", None, Some(id["第二卷"])).unwrap();
    // 在卷之后 → 顶层、整卷之后
    cmd::create_chapter_at_inner(&s, sm.book_id, "幕间", Some(id["第一卷"]), None).unwrap();
    assert_eq!(
        shape(&s, sm.book_id),
        sh(&[
            ("序章", None),
            ("第一卷", None),
            ("甲", Some("第一卷")),
            ("甲二", Some("第一卷")),
            ("乙", Some("第一卷")),
            ("幕间", None),
            ("第二卷", None),
            ("丙", Some("第二卷")),
            ("丙二", Some("第二卷")),
            ("尾声", None),
        ])
    );
    assert_consistent(&s, sm.book_id, &sm.slug);
}

#[test]
fn renaming_volume_moves_children_and_keeps_histories() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    // 卷首语：写进卷目录的 _index.md，读得回、有历史
    cmd::write_chapter_inner(&s, id["第一卷"], "风雪夜，旧人归。").unwrap();
    assert_eq!(cmd::read_chapter_inner(&s, id["第一卷"]).unwrap().content, "风雪夜，旧人归。");
    assert_eq!(cmd::list_history_inner(&s, id["第一卷"]).unwrap().len(), 1);
    cmd::rename_chapter_inner(&s, id["第一卷"], "风雪卷").unwrap();
    assert_eq!(db_tree(&s, sm.book_id)[1..4], ["0002-风雪卷/", "0002-风雪卷/0003-甲.md", "0002-风雪卷/0004-乙.md"]);
    assert_consistent(&s, sm.book_id, &sm.slug);
    assert!(s.root.join(&sm.slug).join("manuscript/0002-风雪卷/_index.md").exists(), "卷首语随目录走");
    assert_eq!(cmd::read_chapter_inner(&s, id["第一卷"]).unwrap().content, "风雪夜，旧人归。");
    assert_eq!(cmd::list_history_inner(&s, id["第一卷"]).unwrap().len(), 1, "卷首语历史随目录名迁移");
    assert_eq!(cmd::list_history_inner(&s, id["甲"]).unwrap().len(), 1, "卷内章历史不受影响");
}

#[test]
fn trash_restore_returns_chapter_to_its_volume() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    cmd::delete_chapter_inner(&s, id["甲"]).unwrap();
    // 删除期间卷改名、目录也换了
    cmd::rename_chapter_inner(&s, id["第一卷"], "风雪卷").unwrap();
    trash::restore_chapter_inner(&s, id["甲"]).unwrap();
    let jia = nodes(&s, sm.book_id).into_iter().find(|n| n.id == id["甲"]).unwrap();
    assert_eq!(jia.parent_id, Some(id["第一卷"]), "回到原卷");
    assert!(jia.file_path.contains("/0002-风雪卷/"), "落在原卷的当前目录：{}", jia.file_path);
    assert_consistent(&s, sm.book_id, &sm.slug);
    assert_eq!(cmd::read_chapter_inner(&s, id["甲"]).unwrap().content, "甲的正文。");
}

#[test]
fn deleting_volume_cascades_and_restores() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    cmd::write_chapter_inner(&s, id["第一卷"], "卷首语").unwrap();
    cmd::delete_chapter_inner(&s, id["第一卷"]).unwrap();
    let titles: Vec<String> = cmd::list_chapters_inner(&s, sm.book_id).unwrap().into_iter().map(|c| c.title).collect();
    assert_eq!(titles, ["序章", "丙", "尾声"], "卷内的章一并进回收站");
    assert_eq!(trash::list_trash_inner(&s, sm.book_id).unwrap().len(), 3);
    assert!(!disk_tree(&s, &sm.slug).iter().any(|p| p.contains("第一卷")), "卷目录整体移走");
    // 卷还在回收站时恢复其中一章 → 回到顶层
    trash::restore_chapter_inner(&s, id["乙"]).unwrap();
    assert_eq!(nodes(&s, sm.book_id).iter().find(|n| n.id == id["乙"]).unwrap().parent_id, None);
    assert_consistent(&s, sm.book_id, &sm.slug);
    // 恢复卷 → 再恢复甲 → 甲回到卷里；卷首语也在
    trash::restore_chapter_inner(&s, id["第一卷"]).unwrap();
    trash::restore_chapter_inner(&s, id["甲"]).unwrap();
    assert_eq!(nodes(&s, sm.book_id).iter().find(|n| n.id == id["甲"]).unwrap().parent_id, Some(id["第一卷"]));
    assert_eq!(cmd::read_chapter_inner(&s, id["第一卷"]).unwrap().content, "卷首语");
    assert_consistent(&s, sm.book_id, &sm.slug);
    // 彻底删除卷：目录删掉、行删掉
    cmd::delete_chapter_inner(&s, id["第一卷"]).unwrap();
    trash::empty_trash_inner(&s, sm.book_id).unwrap();
    assert!(trash::list_trash_inner(&s, sm.book_id).unwrap().is_empty());
    assert!(!s.root.join(&sm.slug).join(".trash").read_dir().map(|mut d| d.next().is_some()).unwrap_or(false));
}

#[test]
fn import_lands_volumes_as_directories() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "导入书").unwrap();
    let p = |t: &str, v: Option<&str>| ParsedChapter { title: t.into(), content: format!("{t}正文"), volume: v.map(String::from) };
    let report = import_chapters_inner(
        &s,
        book.id,
        &[p("楔子", None), p("第一章", Some("第一卷 风起")), p("第二章", Some("第一卷 风起")), p("第三章", Some("第二卷 云涌"))],
    )
    .unwrap();
    assert_eq!(report.chapters, 4);
    assert_eq!(
        shape(&s, book.id),
        sh(&[
            ("楔子", None),
            ("第一卷 风起", None),
            ("第一章", Some("第一卷 风起")),
            ("第二章", Some("第一卷 风起")),
            ("第二卷 云涌", None),
            ("第三章", Some("第二卷 云涌")),
        ])
    );
    assert_eq!(db_tree(&s, book.id)[1], "0002-第一卷-风起/");
    assert_consistent(&s, book.id, &book.slug);
    let third = cmd::list_chapters_inner(&s, book.id).unwrap().pop().unwrap();
    assert_eq!(cmd::read_chapter_inner(&s, third.id).unwrap().content, "第三章正文");
}

#[test]
fn export_txt_outputs_volume_titles_and_preface() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    cmd::write_chapter_inner(&s, sm.id["第一卷"], "风雪夜，旧人归。").unwrap();
    let txt = build_txt(&s, sm.book_id, &ExportRange::default(), false).unwrap();
    let pos = |needle: &str| txt.find(needle).unwrap_or_else(|| panic!("缺少「{needle}」：{txt}"));
    assert!(pos("序章") < pos("第一卷") && pos("第一卷") < pos("风雪夜") && pos("风雪夜") < pos("甲的正文"));
    assert!(pos("乙的正文") < pos("第二卷") && pos("第二卷") < pos("丙的正文") && pos("丙的正文") < pos("尾声"));
    assert_eq!(txt.matches("第一卷").count(), 1, "同一卷只输出一次卷名");
    // 只导出丙：只带它所在的卷名
    let only = build_txt(&s, sm.book_id, &ExportRange { chapter_ids: vec![sm.id["丙"]] }, false).unwrap();
    assert!(only.starts_with("第二卷") && !only.contains("第一卷"), "{only}");
}

#[test]
fn split_and_merge_round_trip() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    cmd::write_chapter_inner(&s, id["甲"], "前半段。\n\n后半段。").unwrap();
    let tail = cmd::chapter_split_inner(&s, id["甲"], "前半段。", "后半段。", "甲（续）").unwrap();
    assert_eq!(tail.parent_id, Some(id["第一卷"]), "新章紧随其后、同卷");
    assert_eq!(cmd::read_chapter_inner(&s, id["甲"]).unwrap().content, "前半段。");
    assert_eq!(cmd::read_chapter_inner(&s, tail.id).unwrap().content, "后半段。");
    let hist = cmd::list_history_inner(&s, id["甲"]).unwrap();
    assert!(
        hist.iter().any(|h| cmd::read_history_inner(&s, id["甲"], &h.file).unwrap() == "前半段。\n\n后半段。"),
        "拆分前全文有强制快照"
    );
    assert_consistent(&s, sm.book_id, &sm.slug);

    // 不相邻 / 跨卷 / 含卷 → 拒绝
    assert!(cmd::chapter_merge_inner(&s, &[id["序章"], id["尾声"]]).is_err());
    assert!(cmd::chapter_merge_inner(&s, &[id["乙"], id["丙"]]).is_err());
    assert!(cmd::chapter_merge_inner(&s, &[id["第一卷"], id["甲"]]).is_err());

    let r = cmd::chapter_merge_inner(&s, &[tail.id, id["甲"]]).unwrap();
    assert_eq!(r.merged.id, id["甲"], "并入全书序靠前的那章");
    assert_eq!(r.original, "前半段。");
    assert_eq!(r.removed, vec![tail.id]);
    assert_eq!(cmd::read_chapter_inner(&s, id["甲"]).unwrap().content, "前半段。\n\n后半段。");
    assert_eq!(trash::list_trash_inner(&s, sm.book_id).unwrap().len(), 1);
    assert_consistent(&s, sm.book_id, &sm.slug);
}

#[test]
fn reorder_chapters_fills_slots_across_volumes() {
    let (_tmp, s) = setup();
    let sm = sample(&s);
    let id = &sm.id;
    cmd::reorder_chapters_inner(&s, &[id["乙"], id["甲"]]).unwrap();
    // 甲 ↔ 丙：各自占对方的位置、继承该位置的卷
    cmd::reorder_chapters_inner(&s, &[id["丙"], id["甲"]]).unwrap();
    assert_eq!(
        shape(&s, sm.book_id),
        sh(&[("序章", None), ("第一卷", None), ("乙", Some("第一卷")), ("丙", Some("第一卷")), ("第二卷", None), ("甲", Some("第二卷")), ("尾声", None)])
    );
    assert_consistent(&s, sm.book_id, &sm.slug);
    assert!(cmd::reorder_chapters_inner(&s, &[id["第一卷"], id["序章"]]).is_err(), "卷不走章节重排");
}

#[test]
fn migration_upgrade_keeps_flat_books_intact() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("old.db");
    {
        let mut conn = rusqlite::Connection::open(&path).unwrap();
        bixian::db::migrations().to_version(&mut conn, 19).unwrap();
        conn.execute("INSERT INTO books (title, slug) VALUES ('旧书', 'jiu')", []).unwrap();
        conn.execute(
            "INSERT INTO chapters (book_id, file_path, title, sort_key) VALUES (1, 'jiu/manuscript/0001-yi.md', '一', 1.0), (1, 'jiu/manuscript/0002-er.md', '二', 2.0)",
            [],
        )
        .unwrap();
    }
    let mut conn = rusqlite::Connection::open(&path).unwrap();
    bixian::db::init(&mut conn).unwrap();
    let list = bixian::repo::chapters::list_nodes(&conn, 1).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list.iter().all(|c| c.kind == "text" && c.parent_id.is_none()), "旧章全部为顶层正文章");
    assert_eq!(bixian::repo::chapters::list_by_book(&conn, 1).unwrap().len(), 2);
    assert_eq!(list[0].title, "一");
}
