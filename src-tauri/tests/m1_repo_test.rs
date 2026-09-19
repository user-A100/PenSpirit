use bixian::db;
use bixian::models::ProviderProfile;
use bixian::repo;
use rusqlite::Connection;

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    db::init(&mut conn).unwrap();
    conn
}

fn book_and_chapter(conn: &Connection) -> (i64, i64) {
    let book = repo::books::create(conn, "书", "shu").unwrap();
    let ch = repo::chapters::create(conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    (book.id, ch.id)
}

fn provider(id: i64, name: &str) -> ProviderProfile {
    ProviderProfile {
        id,
        name: name.into(),
        base_url: "https://api.test/v1".into(),
        api_key: "sk-test".into(),
        model: "test-model".into(),
        max_tokens: 1024,
        temperature: 0.7,
    }
}

// ---------- settings KV ----------

#[test]
fn settings_set_get_roundtrip() {
    let conn = test_conn();
    assert_eq!(repo::settings::get(&conn, "k").unwrap(), None);
    repo::settings::set(&conn, "k", "v1").unwrap();
    assert_eq!(repo::settings::get(&conn, "k").unwrap(), Some("v1".into()));
    repo::settings::set(&conn, "k", "v2").unwrap(); // upsert 覆盖
    assert_eq!(repo::settings::get(&conn, "k").unwrap(), Some("v2".into()));
}

// ---------- providers ----------

#[test]
fn providers_empty_when_unset() {
    let conn = test_conn();
    assert!(repo::settings::providers(&conn).unwrap().is_empty());
}

#[test]
fn save_provider_new_assigns_max_plus_one() {
    let conn = test_conn();
    let p1 = repo::settings::save_provider(&conn, &provider(0, "一")).unwrap();
    let p2 = repo::settings::save_provider(&conn, &provider(0, "二")).unwrap();
    assert_eq!(p1.id, 1);
    assert_eq!(p2.id, 2); // 从 JSON 里取 max(id)+1
    let list = repo::settings::providers(&conn).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "一");
    assert_eq!(list[1].name, "二");
    assert_eq!(list[1].api_key, "sk-test"); // 明文透传
    assert!((list[1].temperature - 0.7).abs() < 1e-9);
}

#[test]
fn save_provider_update_keeps_id_in_place() {
    let conn = test_conn();
    let p1 = repo::settings::save_provider(&conn, &provider(0, "一")).unwrap();
    let p2 = repo::settings::save_provider(&conn, &provider(0, "二")).unwrap();
    let mut edited = provider(p1.id, "改名");
    edited.model = "new-model".into();
    let saved = repo::settings::save_provider(&conn, &edited).unwrap();
    assert_eq!(saved.id, p1.id);
    let list = repo::settings::providers(&conn).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].name, "改名");
    assert_eq!(list[0].model, "new-model");
    assert_eq!(list[1].id, p2.id); // 不影响他人
}

#[test]
fn save_provider_update_missing_id_errors() {
    let conn = test_conn();
    assert!(repo::settings::save_provider(&conn, &provider(9, "不存在")).is_err());
}

#[test]
fn delete_provider_removes_entry() {
    let conn = test_conn();
    let p1 = repo::settings::save_provider(&conn, &provider(0, "一")).unwrap();
    let _p2 = repo::settings::save_provider(&conn, &provider(0, "二")).unwrap();
    repo::settings::delete_provider(&conn, p1.id).unwrap();
    let list = repo::settings::providers(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "二");
    // 删除后新增：max+1 从剩余 JSON 计算，不复用 1，分配 3
    let p3 = repo::settings::save_provider(&conn, &provider(0, "三")).unwrap();
    assert_eq!(p3.id, 3);
}

// ---------- active_provider / active_style ----------

#[test]
fn active_provider_roundtrip() {
    let conn = test_conn();
    assert_eq!(repo::settings::active_provider_id(&conn).unwrap(), None);
    repo::settings::set_active_provider(&conn, 3).unwrap();
    assert_eq!(repo::settings::active_provider_id(&conn).unwrap(), Some(3));
}

#[test]
fn active_style_per_book() {
    let conn = test_conn();
    let (book_id, _) = book_and_chapter(&conn);
    assert_eq!(repo::settings::active_style_id(&conn, book_id).unwrap(), None);
    repo::settings::set_active_style(&conn, book_id, 7).unwrap();
    assert_eq!(repo::settings::active_style_id(&conn, book_id).unwrap(), Some(7));
    let b2 = repo::books::create(&conn, "书二", "shu2").unwrap();
    assert_eq!(repo::settings::active_style_id(&conn, b2.id).unwrap(), None); // 每书独立
    repo::settings::set_active_style(&conn, book_id, 8).unwrap(); // 覆盖
    assert_eq!(repo::settings::active_style_id(&conn, book_id).unwrap(), Some(8));
}

// ---------- sessions ----------

#[test]
fn get_or_create_session_idempotent_per_chapter() {
    let conn = test_conn();
    let (book_id, ch_id) = book_and_chapter(&conn);
    let s1 = repo::sessions::get_or_create(&conn, ch_id, book_id, "初见 · AI").unwrap();
    let s2 = repo::sessions::get_or_create(&conn, ch_id, book_id, "初见 · AI").unwrap();
    assert_eq!(s1.id, s2.id);
    assert_eq!(s1.title, "初见 · AI");
    assert_eq!(s1.book_id, book_id);
    assert_eq!(s1.chapter_id, ch_id);
    let list = repo::sessions::list_by_chapter(&conn, ch_id).unwrap();
    assert_eq!(list.len(), 1); // 该章唯一
    // 其他章不受影响
    let ch2 = repo::chapters::create(&conn, book_id, "shu/manuscript/0002-b.md", "二").unwrap();
    assert!(repo::sessions::list_by_chapter(&conn, ch2.id).unwrap().is_empty());
}

#[test]
fn session_delete_cascades_messages() {
    let conn = test_conn();
    let (book_id, ch_id) = book_and_chapter(&conn);
    let s = repo::sessions::get_or_create(&conn, ch_id, book_id, "t").unwrap();
    repo::sessions::append_message(&conn, s.id, "user", "你好").unwrap();
    repo::sessions::append_message(&conn, s.id, "assistant", "好的").unwrap();
    repo::sessions::delete(&conn, s.id).unwrap();
    assert!(repo::sessions::list_by_chapter(&conn, ch_id).unwrap().is_empty());
    assert!(repo::sessions::list_messages(&conn, s.id).unwrap().is_empty()); // 级联删
}

// ---------- messages ----------

#[test]
fn messages_append_update_delete() {
    let conn = test_conn();
    let (book_id, ch_id) = book_and_chapter(&conn);
    let s = repo::sessions::get_or_create(&conn, ch_id, book_id, "t").unwrap();
    let m1 = repo::sessions::append_message(&conn, s.id, "user", "写一段").unwrap();
    let m2 = repo::sessions::append_message(&conn, s.id, "assistant", "好的").unwrap();
    assert!(m1.id < m2.id);
    assert_eq!(m1.session_id, s.id);
    assert!(!m1.created_at.is_empty());
    let list = repo::sessions::list_messages(&conn, s.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].role, "user");
    assert_eq!(list[1].content, "好的");
    repo::sessions::update_message(&conn, m2.id, "改好的正文").unwrap();
    let list = repo::sessions::list_messages(&conn, s.id).unwrap();
    assert_eq!(list[1].content, "改好的正文");
    repo::sessions::delete_message(&conn, m1.id).unwrap();
    let list = repo::sessions::list_messages(&conn, s.id).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, m2.id);
}

// ---------- styles ----------

#[test]
fn styles_crud_full_chain() {
    let conn = test_conn();
    assert!(repo::styles::list(&conn).unwrap().is_empty());
    let tags = r#"["仙侠","冷峻"]"#;
    let s = repo::styles::create(&conn, "冷峻", "以冷峻笔法叙事", "样章……", tags).unwrap();
    assert_eq!(s.name, "冷峻");
    assert_eq!(s.tags, tags); // 仓库层不解析只透传
    assert!(!s.created_at.is_empty());
    assert!(!s.updated_at.is_empty());

    let u = repo::styles::update(&conn, s.id, "冷峻·改", "新指令", "新样章", "[]").unwrap();
    assert_eq!(u.id, s.id);
    assert_eq!(u.name, "冷峻·改");
    assert_eq!(u.prompt_md, "新指令");
    assert_eq!(u.sample_md, "新样章");
    assert_eq!(u.tags, "[]");

    let list = repo::styles::list(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "冷峻·改");

    // 多条按 id 排序
    let _s2 = repo::styles::create(&conn, "婉约", "以婉约笔法", "", "[]").unwrap();
    let list = repo::styles::list(&conn).unwrap();
    assert_eq!(list.len(), 2);
    assert!(list[0].id < list[1].id);

    repo::styles::delete(&conn, s.id).unwrap();
    let list = repo::styles::list(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].name, "婉约");
}
