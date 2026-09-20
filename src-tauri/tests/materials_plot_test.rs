//! M4 素材库（全局 CRUD + 搜索）与情节块（按书、三态流转、重排）。

use bixian::commands as cmd;
use bixian::error::AppError;
use bixian::models::{MaterialInput, PlotBlockInput};
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn mat(title: &str, category: &str, content: &str, tags: &str) -> MaterialInput {
    MaterialInput {
        id: None,
        title: title.into(),
        category: category.into(),
        content: content.into(),
        tags: tags.into(),
    }
}

#[test]
fn materials_crud_and_search() {
    let (_tmp, s) = setup();
    cmd::material_upsert_inner(&s, &mat("幽冥湖", "地名", "湖底有青铜门。", "副本,水")).unwrap();
    cmd::material_upsert_inner(&s, &mat("锁龙桩", "道具", "封印用的石桩。", "封印")).unwrap();
    let m3 = cmd::material_upsert_inner(&s, &mat("灯下黑", "金句", "最危险的地方最安全。", "")).unwrap();

    let all = cmd::materials_list_inner(&s, None).unwrap();
    assert_eq!(all.len(), 3);
    // 分类聚拢：地名/道具/金句字典序
    let cats: Vec<&str> = all.iter().map(|m| m.category.as_str()).collect();
    assert_eq!(cats, vec!["地名", "道具", "金句"]);

    // 搜索命中标题/内容
    let hit = cmd::materials_list_inner(&s, Some("青铜".into())).unwrap();
    assert_eq!(hit.len(), 1);
    assert_eq!(hit[0].title, "幽冥湖");
    let hit_tag = cmd::materials_list_inner(&s, Some("封印".into())).unwrap();
    assert_eq!(hit_tag.len(), 1, "标签可搜");
    assert!(cmd::materials_list_inner(&s, Some("不存在词".into())).unwrap().is_empty());

    // 更新 + 空名拒绝 + 删除
    let up = cmd::material_upsert_inner(
        &s,
        &MaterialInput { id: Some(m3.id), category: "桥段".into(), ..mat("灯下黑", "", "", "") },
    )
    .unwrap();
    assert_eq!(up.category, "桥段");
    let err = cmd::material_upsert_inner(&s, &mat("  ", "", "", "")).unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    cmd::material_delete_inner(&s, m3.id).unwrap();
    assert_eq!(cmd::materials_list_inner(&s, None).unwrap().len(), 2);
}

#[test]
fn plot_blocks_lifecycle_and_reorder() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let ch = cmd::create_chapter_inner(&s, book.id, "一").unwrap();

    let b1 = cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: book.id, content: "湖边遇袭".into(), status: "idea".into(), chapter_id: None, sort_key: 0, id: None },
    )
    .unwrap();
    let b2 = cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: book.id, content: "入湖探门".into(), status: "ready".into(), chapter_id: None, sort_key: 1, id: None },
    )
    .unwrap();
    let b3 = cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: book.id, content: "旧事重提".into(), status: "used".into(), chapter_id: Some(ch.id), sort_key: 2, id: None },
    )
    .unwrap();

    // 排序：idea → ready → used
    let list = cmd::plot_blocks_list_inner(&s, book.id).unwrap();
    let ids: Vec<i64> = list.iter().map(|b| b.id).collect();
    assert_eq!(ids, vec![b1.id, b2.id, b3.id]);

    // 拖拽重排：b2 提到最前（同状态组内）
    cmd::plot_block_reorder_inner(&s, &[b2.id, b1.id, b3.id]).unwrap();
    let after = cmd::plot_blocks_list_inner(&s, book.id).unwrap();
    // 重排只改 sort_key，状态分组仍是主序：b2(ready) 仍在 b1(idea) 后
    let mut ready_first: Vec<i64> = after.iter().filter(|b| b.status != "used").map(|b| b.id).collect();
    ready_first.sort();
    assert_eq!(ready_first, vec![b1.id, b2.id]);
    assert_eq!(after[0].sort_key, 1, "b1 的 sort_key 已被重排写入");

    // 校验：空内容/非法状态
    let err = cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: book.id, content: "  ".into(), status: "idea".into(), chapter_id: None, sort_key: 0, id: None },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));
    let err = cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: book.id, content: "x".into(), status: "done".into(), chapter_id: None, sort_key: 0, id: None },
    )
    .unwrap_err();
    assert!(matches!(err, AppError::Invalid(_)));

    // 删书是软删（回收站体系）——情节块保留；物理清除时 FK 级联
    cmd::delete_book_inner(&s, book.id).unwrap();
    assert_eq!(cmd::plot_blocks_list_inner(&s, book.id).unwrap().len(), 3, "软删不丢情节块");
}

#[test]
fn plot_blocks_scoped_by_book() {
    let (_tmp, s) = setup();
    let b1 = cmd::create_book_inner(&s, "书一").unwrap();
    let b2 = cmd::create_book_inner(&s, "书二").unwrap();
    cmd::plot_block_upsert_inner(
        &s,
        &PlotBlockInput { book_id: b1.id, content: "甲书块".into(), status: "idea".into(), chapter_id: None, sort_key: 0, id: None },
    )
    .unwrap();
    assert_eq!(cmd::plot_blocks_list_inner(&s, b1.id).unwrap().len(), 1);
    assert!(cmd::plot_blocks_list_inner(&s, b2.id).unwrap().is_empty());
}
