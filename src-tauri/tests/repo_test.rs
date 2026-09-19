use bixian::db;
use bixian::repo;
use rusqlite::Connection;

fn test_conn() -> Connection {
    let mut conn = Connection::open_in_memory().unwrap();
    db::init(&mut conn).unwrap();
    conn
}

#[test]
fn create_book_and_chapters_ordered() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "红楼梦", "hongloumeng").unwrap();
    assert_eq!(book.title, "红楼梦");
    let c1 = repo::chapters::create(&conn, book.id, "hongloumeng/manuscript/0001-chu-jian.md", "初见").unwrap();
    let c2 = repo::chapters::create(&conn, book.id, "hongloumeng/manuscript/0002-feng-bo.md", "风波").unwrap();
    let list = repo::chapters::list_by_book(&conn, book.id).unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].id, c1.id);
    assert_eq!(list[1].id, c2.id);
    assert!(list[0].sort_key < list[1].sort_key);
}

#[test]
fn next_index_increments_and_survives_delete() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    let c2 = repo::chapters::create(&conn, book.id, "shu/manuscript/0002-b.md", "二").unwrap();
    assert_eq!(repo::chapters::next_index(&conn, book.id).unwrap(), 3);
    repo::chapters::delete(&conn, c2.id).unwrap();
    assert_eq!(repo::chapters::next_index(&conn, book.id).unwrap(), 3); // 只增不减，避免重名
}

#[test]
fn delete_book_cascades_chapters() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    repo::books::delete(&conn, book.id).unwrap();
    assert!(repo::chapters::list_by_book(&conn, book.id).unwrap().is_empty());
    assert!(repo::books::get(&conn, book.id).is_err());
}

#[test]
fn rename_updates_title_and_path() {
    let conn = test_conn();
    let book = repo::books::create(&conn, "书", "shu").unwrap();
    let c = repo::chapters::create(&conn, book.id, "shu/manuscript/0001-a.md", "一").unwrap();
    let r = repo::chapters::rename(&conn, c.id, "新标题", "shu/manuscript/0001-xin-biao-ti.md").unwrap();
    assert_eq!(r.title, "新标题");
    assert_eq!(r.file_path, "shu/manuscript/0001-xin-biao-ti.md");
}
