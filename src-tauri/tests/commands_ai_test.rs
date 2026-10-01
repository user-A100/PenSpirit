use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::error::AppError;
use bixian::models::{AiTurnOptions, Mention, ProviderProfile};
use bixian::repo;
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn provider(id: i64, name: &str) -> ProviderProfile {
    ProviderProfile {
        id,
        name: name.into(),
        base_url: "https://api.test/v1".into(),
        api_key: "sk-secret-test".into(),
        model: "test-model".into(),
        max_tokens: 2048,
        temperature: 0.7,
    }
}

/// 阶段 2B：自定义命令绑定的模型——本轮指定服务商时用它，不改「使用中」；没指定 / 已删除回落到使用中
#[test]
fn 本轮指定服务商_不改使用中() {
    let (_tmp, s) = setup();
    let active = activate_provider(&s);
    let mut other = provider(0, "绑定的模型");
    other.model = "bound-model".into();
    let other = cmd::save_provider_inner(&s, other).unwrap();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let sess = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let opts = AiTurnOptions { provider_id: Some(other.id), temperature: Some(0.2), ..Default::default() };
    let t = cmd::send_prepare(&s, sess.id, "写一段", &opts).unwrap();
    assert_eq!(t.req.model, "bound-model");
    assert_eq!(t.req.temperature, 0.2);
    assert_eq!(cmd::get_active_provider_inner(&s).unwrap(), Some(active.id));
    cmd::cancel_generation_inner(&s, sess.id).ok();
    let t2 = cmd::send_prepare(&s, sess.id, "再写", &AiTurnOptions { provider_id: Some(9999), ..Default::default() }).unwrap();
    assert_eq!(t2.req.model, "test-model");
}

fn activate_provider(s: &AppState) -> ProviderProfile {
    let p = cmd::save_provider_inner(s, provider(0, "测试服务商")).unwrap();
    cmd::set_active_provider_inner(s, p.id).unwrap();
    p
}

/// 一本书两章：第一章已写正文，返回 (book_id, 第一章 id, 第二章 id)
fn book_with_two_chapters(s: &AppState) -> (i64, i64, i64) {
    let book = m0::create_book_inner(s, "凡人修仙").unwrap();
    let ch1 = m0::create_chapter_inner(s, book.id, "初入山门").unwrap();
    let ch2 = m0::create_chapter_inner(s, book.id, "再遇故人").unwrap();
    m0::write_chapter_inner(s, ch1.id, "韩立背着行囊，缓缓走入山门。").unwrap();
    (book.id, ch1.id, ch2.id)
}

fn cancels_len(s: &AppState) -> usize {
    s.cancels.lock().unwrap().len()
}

fn opts() -> AiTurnOptions {
    AiTurnOptions::default()
}

// ---------- send_prepare ----------

#[test]
fn send_prepare_without_provider_is_invalid() {
    let (_tmp, s) = setup();
    let (book, _ch1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let err = cmd::send_prepare(&s, session.id, "继续写", &opts()).err().unwrap();
    match err {
        AppError::Invalid(msg) => assert!(msg.contains("AI 服务商"), "实际消息: {msg}"),
        other => panic!("应为 Invalid 错误，实际: {other:?}"),
    }
    let _ = book;
}

#[test]
fn send_prepare_builds_req_and_persists_user_message() {
    let (_tmp, s) = setup();
    let p = activate_provider(&s);
    let (book_id, ch1, ch2) = book_with_two_chapters(&s);
    m0::write_chapter_inner(&s, ch2, "（第二章已有草稿）").unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();

    let turn = cmd::send_prepare(&s, session.id, "写第二章开头", &opts()).unwrap();
    let (user_msg, req) = (turn.user_msg, turn.req);

    // user 消息已落库且返回
    assert_eq!(user_msg.session_id, session.id);
    assert_eq!(user_msg.role, "user");
    assert_eq!(user_msg.content, "写第二章开头");
    let msgs = cmd::list_messages_inner(&s, session.id).unwrap();
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].id, user_msg.id);

    // StreamReq 字段来自 provider 档案
    assert_eq!(req.base_url, "https://api.test/v1");
    assert_eq!(req.api_key, "sk-secret-test");
    assert_eq!(req.model, "test-model");
    assert_eq!(req.max_tokens, 2048);
    assert!((req.temperature - 0.7).abs() < 1e-9);

    // system 含书名与上一章结尾（阶段 2A 起前情进 system）；首轮无对话历史；user 含指令
    assert!(req.system.contains("凡人修仙"), "system 应含书名: {}", req.system);
    assert!(req.system.contains("【上一章结尾】\n韩立背着行囊"));
    assert!(req.history.is_empty());
    // 当前章非空：user = 正文尾窗 + 写作指令
    assert!(req.user.contains("【当前章节已有正文（尾部）】"));
    assert!(req.user.contains("（第二章已有草稿）"));
    assert!(req.user.contains("【写作指令】"));
    assert!(req.user.contains("写第二章开头"));
    let _ = (book_id, ch1);

    // cancel 信号已登记
    assert_eq!(cancels_len(&s), 1);
}

#[test]
fn send_prepare_no_prev_chapter_skips_history() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let book = m0::create_book_inner(&s, "孤本").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "唯一章").unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let req = cmd::send_prepare(&s, session.id, "起笔", &opts()).unwrap().req;
    assert!(req.history.is_empty());
    // 空章节正文：user 即指令本身
    assert_eq!(req.user, "起笔");
}

// ---------- cancel ----------

#[test]
fn cancel_unknown_session_is_ok_and_idempotent() {
    let (_tmp, s) = setup();
    cmd::cancel_generation_inner(&s, 999).unwrap();
    cmd::cancel_generation_inner(&s, 999).unwrap(); // 幂等
}

#[test]
fn cancel_after_prepare_signals_and_clears_map() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let mut rx = cmd::send_prepare(&s, session.id, "写", &opts()).unwrap().cancel_rx;
    assert!(!*rx.borrow_and_update());
    cmd::cancel_generation_inner(&s, session.id).unwrap();
    assert!(*rx.borrow_and_update()); // 收到 true
    assert_eq!(cancels_len(&s), 0); // 已从 map 移除
}

// ---------- get_or_create_session ----------

#[test]
fn get_or_create_session_idempotent_with_chapter_title() {
    let (_tmp, s) = setup();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let s1 = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let s2 = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    assert_eq!(s1.id, s2.id);
    assert_eq!(s1.title, "再遇故人 · AI");
    assert_eq!(s1.chapter_id, ch2);
    assert_eq!(cmd::list_sessions_inner(&s, ch2).unwrap().len(), 1);
}

// ---------- preview_context ----------

#[test]
fn preview_context_empty_chapter_has_two_slots() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "新书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "空章").unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let log = cmd::preview_context_inner(&s, session.id, "写一个雪夜", &opts()).unwrap();
    assert_eq!(log.slots.len(), 2);
    assert_eq!(log.slots[0].name, "System");
    assert_eq!(log.slots[1].name, "写作指令");
    assert!(log.total_est_tokens > 0);
    assert_eq!(log.slots[1].chars, "写一个雪夜".chars().count() as i64);
}

#[test]
fn preview_context_includes_style_and_prev_slots() {
    let (_tmp, s) = setup();
    let (book, _ch1, ch2) = book_with_two_chapters(&s);
    let style = cmd::save_style_inner(
        &s, 0, "冷峻", "以冷峻笔法叙事，短句为主", "", r#"["冷峻"]"#,
    )
    .unwrap();
    cmd::set_active_style_inner(&s, book, style.id).unwrap();
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let log = cmd::preview_context_inner(&s, session.id, "继续推进剧情", &opts()).unwrap();
    let names: Vec<&str> = log.slots.iter().map(|x| x.name.as_str()).collect();
    assert_eq!(names, vec!["System", "文风", "上一章结尾", "写作指令"]);
    assert!(log.total_est_tokens > 0);
    // 不落库：预览后消息列表仍为空
    assert!(cmd::list_messages_inner(&s, session.id).unwrap().is_empty());
}

// ---------- 阶段 2A：多轮 / 版本 / 编辑重发 / 会话 / 光标 / 引用 ----------

#[test]
fn second_turn_carries_previous_qa_as_history() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let (_b, _c1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let t1 = cmd::send_prepare(&s, session.id, "写他推门进屋", &opts()).unwrap();
    {
        let conn = s.db.lock().unwrap();
        repo::sessions::append_reply(&conn, session.id, t1.user_msg.id, "他推开门，屋里一片漆黑。", "{}").unwrap();
    }
    let t2 = cmd::send_prepare(&s, session.id, "再紧凑一点", &opts()).unwrap();
    assert_eq!(
        t2.req.history,
        vec![("user".to_string(), "写他推门进屋".to_string()), ("assistant".to_string(), "他推开门，屋里一片漆黑。".to_string())]
    );
    // 会话按首句自动命名（默认标题「章名 · AI」）
    let sess = cmd::list_sessions_inner(&s, ch2).unwrap();
    assert_eq!(sess[0].title, "写他推门进屋");
}

#[test]
fn regenerate_uses_history_before_and_versions_switch() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let (_b, _c1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let q1 = cmd::send_prepare(&s, session.id, "第一问", &opts()).unwrap().user_msg;
    let v1 = {
        let conn = s.db.lock().unwrap();
        repo::sessions::append_reply(&conn, session.id, q1.id, "答一版", "{}").unwrap()
    };
    // 重新生成：不新增 user 消息，历史只取它之前（为空）
    let t = cmd::regenerate_prepare(&s, q1.id, &opts()).unwrap();
    assert_eq!(t.user_msg.id, q1.id);
    assert!(t.req.history.is_empty());
    assert!(t.req.user.contains("第一问"));
    let v2 = {
        let conn = s.db.lock().unwrap();
        repo::sessions::append_reply(&conn, session.id, q1.id, "答二版", "{}").unwrap()
    };
    let msgs = cmd::list_messages_inner(&s, session.id).unwrap();
    assert_eq!(msgs.iter().filter(|m| m.role == "user").count(), 1);
    let replies: Vec<_> = msgs.iter().filter(|m| m.reply_to == Some(q1.id)).collect();
    assert_eq!(replies.len(), 2);
    assert!(!replies[0].active && replies[1].active, "新版本选用、旧版本保留");
    // 切回旧版本：历史组装随之改用旧版
    cmd::message_set_active_inner(&s, v1.id).unwrap();
    let t2 = cmd::send_prepare(&s, session.id, "接着写", &opts()).unwrap();
    assert_eq!(t2.req.history[1].1, "答一版");
    let _ = v2;
    // 采纳标记
    assert!(cmd::message_set_adopted_inner(&s, v1.id, true).unwrap().adopted);
}

#[test]
fn edit_resend_rewrites_and_truncates_following() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let (_b, _c1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let q1 = cmd::send_prepare(&s, session.id, "原问题", &opts()).unwrap().user_msg;
    {
        let conn = s.db.lock().unwrap();
        repo::sessions::append_reply(&conn, session.id, q1.id, "原回答", "{}").unwrap();
    }
    let q2 = cmd::send_prepare(&s, session.id, "后续问题", &opts()).unwrap().user_msg;
    let t = cmd::edit_resend_prepare(&s, q1.id, "改过的问题", &opts()).unwrap();
    assert!(t.req.user.contains("改过的问题"));
    let msgs = cmd::list_messages_inner(&s, session.id).unwrap();
    assert_eq!(msgs.len(), 1, "其后的回答与后续问题全部作废");
    assert_eq!(msgs[0].content, "改过的问题");
    assert!(msgs.iter().all(|m| m.id != q2.id));
    assert!(cmd::edit_resend_prepare(&s, q1.id, "   ", &opts()).is_err());
    // 只截断不生成（agent 后端走这条，随后重新生成）
    let q3 = cmd::send_prepare(&s, session.id, "再问", &opts()).unwrap().user_msg;
    let edited = cmd::chat_edit_truncate_inner(&s, q1.id, "第三版问题").unwrap();
    assert_eq!(edited.content, "第三版问题");
    assert!(cmd::list_messages_inner(&s, session.id).unwrap().iter().all(|m| m.id != q3.id));
}

#[test]
fn sessions_create_rename_delete_and_recent_order() {
    let (_tmp, s) = setup();
    let (_b, _c1, ch2) = book_with_two_chapters(&s);
    let a = cmd::session_create_inner(&s, ch2).unwrap();
    assert_eq!(a.title, "新对话");
    let b = cmd::session_create_inner(&s, ch2).unwrap();
    // 在 a 里记一次使用 → a 排到最前
    std::thread::sleep(std::time::Duration::from_millis(1100));
    {
        let conn = s.db.lock().unwrap();
        repo::sessions::touch(&conn, a.id).unwrap();
    }
    let list = cmd::list_sessions_inner(&s, ch2).unwrap();
    assert_eq!(list[0].id, a.id);
    assert_eq!(cmd::session_rename_inner(&s, b.id, "  反派动机  ").unwrap().title, "反派动机");
    assert!(cmd::session_rename_inner(&s, b.id, " ").is_err());
    cmd::session_delete_inner(&s, a.id).unwrap();
    assert_eq!(cmd::list_sessions_inner(&s, ch2).unwrap().len(), 1);
}

#[test]
fn cursor_options_and_mentions_and_overrides() {
    let (_tmp, s) = setup();
    let _p = activate_provider(&s);
    let (book, ch1, ch2) = book_with_two_chapters(&s);
    m0::write_chapter_inner(&s, ch2, "磁盘上的旧正文").unwrap();
    let ch = cmd::session_create_inner(&s, ch2).unwrap();
    let character = m0::character_upsert_inner(
        &s,
        &bixian::models::CharacterInput {
            id: None, book_id: book, name: "南宫婉".into(), role: "女主".into(), aliases: "".into(), description: "冷傲".into(),
        },
    )
    .unwrap();
    let o = AiTurnOptions {
        mode: Some("discuss".into()),
        cursor_before: Some("编辑器里的光标前文".into()),
        cursor_after: Some("光标后的内容".into()),
        mentions: vec![Mention { kind: "character".into(), id: character.id, passage: None }, Mention { kind: "chapter".into(), id: ch1, passage: None }],
        disabled_slots: vec!["上一章结尾".into()],
        temperature: Some(1.1),
        ..Default::default()
    };
    let req = cmd::send_prepare(&s, ch.id, "她会怎么回应？", &o).unwrap().req;
    assert!(req.user.contains("编辑器里的光标前文"), "光标前文优先于磁盘正文");
    assert!(!req.user.contains("磁盘上的旧正文"));
    assert!(req.user.contains("【光标后文"));
    assert!(req.user.contains("【我的问题】"));
    assert!(req.system.contains("【引用资料】"));
    assert!(req.system.contains("◆ 人物 南宫婉（女主）：冷傲"));
    assert!(req.system.contains("◆ 章节《初入山门》"));
    assert!(!req.system.contains("【上一章结尾】"), "本轮关闭的槽位不注入");
    assert!((req.temperature - 1.1).abs() < 1e-9, "温度覆盖不改服务商配置");
    let log = cmd::preview_context_inner(&s, ch.id, "x", &o).unwrap();
    assert!(log.slots.iter().any(|x| x.name == "上一章结尾" && x.disabled));
    assert!(log.slots.iter().any(|x| x.name == "光标前文"));
}

// ---------- provider CRUD ----------

#[test]
fn provider_save_list_delete_roundtrip() {
    let (_tmp, s) = setup();
    assert!(cmd::list_providers_inner(&s).unwrap().is_empty());
    let p1 = cmd::save_provider_inner(&s, provider(0, "甲")).unwrap();
    assert_eq!(p1.id, 1);
    let list = cmd::list_providers_inner(&s).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].api_key, "sk-secret-test"); // 明文原样
    cmd::set_active_provider_inner(&s, p1.id).unwrap();
    let saved = repo::settings::active_provider_id(&*s.db.lock().unwrap()).unwrap();
    assert_eq!(saved, Some(p1.id));

    let mut edited = provider(p1.id, "甲改");
    edited.model = "new-model".into();
    let updated = cmd::save_provider_inner(&s, edited).unwrap();
    assert_eq!(updated.id, p1.id);
    assert_eq!(cmd::list_providers_inner(&s).unwrap()[0].model, "new-model");

    cmd::delete_provider_inner(&s, p1.id).unwrap();
    assert!(cmd::list_providers_inner(&s).unwrap().is_empty());
}

// ---------- style CRUD ----------

#[test]
fn style_save_update_delete_via_inner() {
    let (_tmp, s) = setup();
    let created = cmd::save_style_inner(&s, 0, "婉约", "以婉约笔法", "样章", "[]").unwrap();
    assert_eq!(created.id, 1);
    let updated = cmd::save_style_inner(&s, created.id, "婉约·改", "新指令", "新样章", "[\"a\"]").unwrap();
    assert_eq!(updated.id, created.id);
    let list = cmd::list_styles_inner(&s).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "婉约·改");
    assert_eq!(list[0].tags, "[\"a\"]");
    cmd::delete_style_inner(&s, created.id).unwrap();
    assert!(cmd::list_styles_inner(&s).unwrap().is_empty());
}

#[test]
fn set_active_style_roundtrip() {
    let (_tmp, s) = setup();
    let book = m0::create_book_inner(&s, "书").unwrap();
    let style = cmd::save_style_inner(&s, 0, "冷峻", "指令", "", "[]").unwrap();
    cmd::set_active_style_inner(&s, book.id, style.id).unwrap();
    let conn = s.db.lock().unwrap();
    assert_eq!(repo::settings::active_style_id(&conn, book.id).unwrap(), Some(style.id));
}

// ---------- messages ----------

#[test]
fn list_and_delete_message_via_inner() {
    let (_tmp, s) = setup();
    let (_book, _ch1, ch2) = book_with_two_chapters(&s);
    let session = cmd::get_or_create_session_inner(&s, ch2).unwrap();
    let m1 = repo::sessions::append_message(&*s.db.lock().unwrap(), session.id, "user", "一").unwrap();
    repo::sessions::append_message(&*s.db.lock().unwrap(), session.id, "assistant", "二").unwrap();
    assert_eq!(cmd::list_messages_inner(&s, session.id).unwrap().len(), 2);
    cmd::delete_message_inner(&s, m1.id).unwrap();
    let left = cmd::list_messages_inner(&s, session.id).unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].role, "assistant");
}
