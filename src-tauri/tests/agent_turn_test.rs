//! 阶段 2B 组 5：agent 工具调用折叠视图、回合文件改动追踪、全部撤销 / 恢复。

use std::fs;
use std::path::Path;

use agent_client_protocol::schema::v1::{
    Diff, ToolCall, ToolCallContent, ToolCallLocation, ToolCallStatus, ToolCallUpdate, ToolCallUpdateFields, ToolKind,
};
use bixian::agents::{changes, tools};
use bixian::commands as cmd;
use bixian::commands_ai as ai;
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

#[test]
fn 工具调用折成精简视图() {
    let cwd = Path::new("/lib/书");
    let mut list = Vec::new();
    let tc = ToolCall::new("t1", "改写 第二章")
        .kind(ToolKind::Edit)
        .status(ToolCallStatus::InProgress)
        .locations(vec![ToolCallLocation::new("/lib/书/manuscript/0002-二.md")]);
    let e = tools::on_tool_call(&mut list, &tc, cwd);
    assert_eq!((e.kind.as_str(), e.status.as_str()), ("edit", "in_progress"));
    assert_eq!(e.paths, vec!["manuscript/0002-二.md".to_string()]);

    let diff = Diff::new("/lib/书/manuscript/0002-二.md", "甲\n乙改\n丙\n丁").old_text("甲\n乙\n丙".to_string());
    let upd = ToolCallUpdate::new(
        "t1",
        ToolCallUpdateFields::new().status(ToolCallStatus::Completed).content(vec![ToolCallContent::Diff(diff)]),
    );
    let e = tools::on_tool_update(&mut list, &upd, cwd);
    assert_eq!(e.status, "completed");
    assert_eq!((e.added, e.removed), (2, 1), "加了「乙改」「丁」，去了「乙」");
    assert_eq!(e.paths.len(), 1, "同一文件不重复");
    assert_eq!(list.len(), 1);

    // 没见过的 id 的更新也接住
    let e2 = tools::on_tool_update(&mut list, &ToolCallUpdate::new("t9", ToolCallUpdateFields::new().title("搜索".to_string())), cwd);
    assert_eq!((e2.title.as_str(), e2.kind.as_str()), ("搜索", "other"));
    assert_eq!(list.len(), 2);
}

/// 一本书三章 + 一条 agent 回答（meta 带撤销包）
struct Fixture {
    book_id: i64,
    slug: String,
    ids: Vec<i64>,
    paths: Vec<String>,
}

fn fixture(s: &AppState) -> Fixture {
    let book = cmd::create_book_inner(s, "书").unwrap();
    let mut ids = Vec::new();
    let mut paths = Vec::new();
    for (t, body) in [("一", "第一章原文。"), ("二", "第二章原文。"), ("三", "第三章原文。")] {
        let c = cmd::create_chapter_inner(s, book.id, t).unwrap();
        cmd::write_chapter_inner(s, c.id, body).unwrap();
        paths.push(c.file_path.strip_prefix(&format!("{}/", book.slug)).unwrap().to_string());
        ids.push(c.id);
    }
    Fixture { book_id: book.id, slug: book.slug, ids, paths }
}

#[test]
fn 回合改动只算_agent_的_应用自己的保存与改名排除() {
    let (_tmp, s) = setup();
    let f = fixture(&s);
    let dir = s.root.join(&f.slug);
    let before = changes::snapshot(&dir);
    assert!(before.keys().all(|k| !k.starts_with('.') && k != "book.json"), "隐藏目录与 book.json 不算");

    // agent：改第一章、新建一章文件、写一份设定笔记、删掉第三章文件
    fs::write(dir.join(&f.paths[0]), "第一章被 AI 改过。").unwrap();
    fs::write(dir.join("manuscript/0099-AI新章.md"), "AI 写的新章。").unwrap();
    fs::write(dir.join("设定.md"), "世界观笔记").unwrap();
    fs::remove_file(dir.join(&f.paths[2])).unwrap();
    // 同一时间用户在编辑器里保存了第二章（应用自己的写）→ 不算 agent 的
    cmd::write_chapter_inner(&s, f.ids[1], "第二章用户自己改的。").unwrap();

    let (ch, undo) = changes::finish_turn(&s, f.book_id, &f.slug, &before);
    let got: Vec<(String, String)> = ch.iter().map(|c| (c.path.clone(), c.kind.clone())).collect();
    assert_eq!(
        got,
        vec![
            (f.paths[0].clone(), "modified".to_string()),
            (f.paths[2].clone(), "deleted".to_string()),
            ("manuscript/0099-AI新章.md".to_string(), "added".to_string()),
            ("设定.md".to_string(), "added".to_string()),
        ],
    );
    assert!(undo.is_some());
    // 索引同步：被改的章字数更新；新章文件建了行
    let conn = s.db.lock().unwrap();
    let nodes = repo::chapters::list_nodes(&conn, f.book_id).unwrap();
    let first = nodes.iter().find(|n| n.id == f.ids[0]).unwrap();
    assert_eq!(first.word_count, bixian::util::count_words("第一章被 AI 改过。"));
    assert!(nodes.iter().any(|n| n.file_path.ends_with("0099-AI新章.md")), "新章文件进了索引");
}

#[test]
fn 回合期间应用改名重排不算_agent_改动() {
    let (_tmp, s) = setup();
    let f = fixture(&s);
    let before = changes::snapshot(&s.root.join(&f.slug));
    cmd::rename_chapter_inner(&s, f.ids[1], "二改名").unwrap();
    let (ch, undo) = changes::finish_turn(&s, f.book_id, &f.slug, &before);
    assert!(ch.is_empty(), "{ch:?}");
    assert!(undo.is_none());
}

#[test]
fn 全部撤销与恢复() {
    let (_tmp, s) = setup();
    let f = fixture(&s);
    let dir = s.root.join(&f.slug);
    let before = changes::snapshot(&dir);
    fs::write(dir.join(&f.paths[0]), "第一章被 AI 改过。").unwrap();
    fs::write(dir.join("manuscript/0099-AI新章.md"), "AI 写的新章。").unwrap();
    fs::write(dir.join("设定.md"), "世界观笔记").unwrap();
    let (ch, undo) = changes::finish_turn(&s, f.book_id, &f.slug, &before);
    assert_eq!(ch.len(), 3);

    // 落一条带撤销包的 agent 回答
    let sess = ai::get_or_create_session_inner(&s, f.ids[0]).unwrap();
    let reply = {
        let conn = s.db.lock().unwrap();
        let u = repo::sessions::append_message(&conn, sess.id, "user", "改一下").unwrap();
        let meta = serde_json::json!({ "backend": "agent", "changes": ch, "undo": undo.unwrap() }).to_string();
        repo::sessions::append_reply(&conn, sess.id, u.id, "改好了", &meta).unwrap()
    };
    let new_id = {
        let conn = s.db.lock().unwrap();
        repo::chapters::list_nodes(&conn, f.book_id).unwrap().into_iter().find(|n| n.file_path.ends_with("0099-AI新章.md")).unwrap().id
    };

    // 撤销：改的写回原文；新章进回收站（索引一致、可找回）；新建的笔记删掉
    let r = changes::toggle_undo(&s, reply.id).unwrap();
    assert!(r.undone);
    assert_eq!(fs::read_to_string(dir.join(&f.paths[0])).unwrap(), "第一章原文。");
    assert!(!dir.join("manuscript/0099-AI新章.md").exists());
    assert!(!dir.join("设定.md").exists());
    let trashed = bixian::trash::list_trash_inner(&s, f.book_id).unwrap();
    assert!(trashed.iter().any(|c| c.id == new_id), "AI 新章进了回收站");
    let first = cmd::read_chapter_inner(&s, f.ids[0]).unwrap();
    assert_eq!(first.meta.word_count, bixian::util::count_words("第一章原文。"));
    let meta: serde_json::Value = {
        let conn = s.db.lock().unwrap();
        serde_json::from_str(&repo::sessions::get_message(&conn, reply.id).unwrap().meta).unwrap()
    };
    assert_eq!(meta["undone"], true);
    assert!(meta["redo"].is_string());

    // 再点一次 = 恢复 AI 改动：新章从回收站还原（还是同一章）
    let r = changes::toggle_undo(&s, reply.id).unwrap();
    assert!(!r.undone);
    assert_eq!(fs::read_to_string(dir.join(&f.paths[0])).unwrap(), "第一章被 AI 改过。");
    assert_eq!(fs::read_to_string(dir.join("设定.md")).unwrap(), "世界观笔记");
    let restored = cmd::read_chapter_inner(&s, new_id).unwrap();
    assert_eq!(restored.content, "AI 写的新章。");
    assert!(restored.meta.deleted_at.is_none());

    // 撤销包路径越界 → 拒绝
    let bad = changes::write_pack(&dir, &vec![changes::PackEntry { path: "../外面.md".into(), chapter_id: None, content: Some("x".into()) }]).unwrap();
    assert!(changes::read_pack(&dir, &bad).is_err());
    assert!(changes::read_pack(&dir, "../x.json").is_err());
}

/// 回归（实机发现）：从回收站还原会重排全书文件序号，路径变了——撤销包必须按章 id 落笔，
/// 否则「恢复」会写到旧路径、凭空多出一章。
#[test]
fn 恢复时还原触发重排_按章id落笔不多出章() {
    let (_tmp, s) = setup();
    let f = fixture(&s);
    let dir = s.root.join(&f.slug);
    let before = changes::snapshot(&dir);
    // agent 新建一个排在最前的章文件，并改第一章
    fs::write(dir.join("manuscript/0000-AI序章.md"), "AI 写的序章。").unwrap();
    fs::write(dir.join(&f.paths[0]), "第一章被 AI 改过。").unwrap();
    let (_ch, undo) = changes::finish_turn(&s, f.book_id, &f.slug, &before);
    let sess = ai::get_or_create_session_inner(&s, f.ids[0]).unwrap();
    let reply = {
        let conn = s.db.lock().unwrap();
        let u = repo::sessions::append_message(&conn, sess.id, "user", "改").unwrap();
        repo::sessions::append_reply(&conn, sess.id, u.id, "好", &serde_json::json!({ "backend": "agent", "undo": undo.unwrap() }).to_string()).unwrap()
    };
    let count = |s: &AppState| {
        let conn = s.db.lock().unwrap();
        repo::chapters::list_nodes(&conn, f.book_id).unwrap().len()
    };
    assert_eq!(count(&s), 4);
    changes::toggle_undo(&s, reply.id).unwrap(); // 序章进回收站、第一章写回原文
    assert_eq!(count(&s), 3);
    assert_eq!(cmd::read_chapter_inner(&s, f.ids[0]).unwrap().content, "第一章原文。");
    changes::toggle_undo(&s, reply.id).unwrap(); // 序章还原（触发重排）、第一章写回 AI 版
    assert_eq!(count(&s), 4, "不能多出章");
    let moved = cmd::read_chapter_inner(&s, f.ids[0]).unwrap().meta.file_path;
    assert_ne!(moved, format!("{}/{}", f.slug, f.paths[0]), "还原应触发重排（本测试要覆盖的情形）");
    assert_eq!(cmd::read_chapter_inner(&s, f.ids[0]).unwrap().content, "第一章被 AI 改过。");
    for (i, id) in f.ids.iter().enumerate().skip(1) {
        assert_eq!(cmd::read_chapter_inner(&s, *id).unwrap().content, ["", "第二章原文。", "第三章原文。"][i]);
    }
    // 再撤销一次照样对
    changes::toggle_undo(&s, reply.id).unwrap();
    assert_eq!(count(&s), 3);
    assert_eq!(cmd::read_chapter_inner(&s, f.ids[0]).unwrap().content, "第一章原文。");
}
