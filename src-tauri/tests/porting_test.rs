use bixian::commands as cmd;
use bixian::porting::export::{export_docx_inner, export_txt_inner, ExportRange};
use bixian::porting::import::{
    detect_and_decode, import_chapters_inner, import_docx, split_txt, ParsedChapter,
};
use bixian::state::AppState;
use bixian::util::count_words;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

const SAMPLE: &str = "\
第一卷 风雪

序章

那天夜里下着雪。

第一章 初见

他推开门。

第二章 刀

刀很冷。

番外 后日谈

很多年以后。
";

fn titles(cs: &[ParsedChapter]) -> Vec<&str> {
    cs.iter().map(|c| c.title.as_str()).collect()
}

// ---- 编码 ----

#[test]
fn decodes_utf8() {
    assert_eq!(detect_and_decode("第一章 初见".as_bytes()), "第一章 初见");
}

#[test]
fn decodes_gbk() {
    // 语料要够长：chardetng 对几十字节的短样本容易猜错
    let src = "第一章 初见\n\n他推开门，风雪灌进来，屋里的灯晃了一下。\n\n\
               第二章 刀\n\n刀很冷，像那年冬天的铁。他把刀放在桌上，慢慢坐了下来。";
    let (gbk_bytes, _, _) = encoding_rs::GBK.encode(src);
    assert_eq!(detect_and_decode(&gbk_bytes), src);
}

#[test]
fn strips_utf8_bom_when_decoding() {
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice("第一章".as_bytes());
    let text = detect_and_decode(&bytes);
    assert!(text.contains("第一章"));
    assert!(!text.starts_with('\u{feff}'), "BOM 不应残留");
}

// ---- 分章 ----

#[test]
fn tight_chapter_matching_avoids_prose_false_positives() {
    // 编号必须紧贴单位字，且不含"节"（books-reader 的刻意取舍）
    let cs = split_txt(
        "第一次集合。\n\n第一节课开始讲卷积。\n\n他去排队。\n\n第二回开场。",
    );
    // 「第一节课开始讲卷积。」以句读结尾，双保险被挡；
    // 「第一次集合。」——「次」不是单位字，紧贴规则不命中
    assert_eq!(cs.len(), 1, "全部是正文，不误切: {:?}", titles(&cs));
}

#[test]
fn fullwidth_digits_and_extra_units_are_chapters() {
    let cs = split_txt("第１２３章 夜行\n\n正文。\n\n第一部 起源\n\n正文。\n\n第一篇 雪\n\n正文。");
    assert_eq!(
        titles(&cs),
        vec!["第１２３章 夜行", "第一部 起源", "第一篇 雪"]
    );
}

#[test]
fn bare_volume_line_groups_but_not_chapters() {
    // 「卷一」无"第"字的卷行 + 英文 Volume 行
    let cs = split_txt("卷一 风雪\n\n第一章 一\n\n正文一。\u{feff}Volume 2\n\nChapter 5\n\n正文二。");
    assert_eq!(titles(&cs), vec!["第一章 一", "Chapter 5"]);
    assert_eq!(cs[0].volume.as_deref(), Some("卷一 风雪"));
    assert_eq!(cs[1].volume.as_deref(), Some("Volume 2"));
}

#[test]
fn english_headings_are_recognized() {
    let cs = split_txt(
        "Prologue\n\nThe snow fell.\n\nChapter 1 The Gate\n\nHe opened it.\n\nPart III\n\nWar.\n\nEpilogue 尾声\n\nYears later.",
    );
    assert_eq!(
        titles(&cs),
        vec!["Prologue", "Chapter 1 The Gate", "Part III", "Epilogue 尾声"]
    );
}

#[test]
fn numbered_headings_dot_style() {
    // `1.标题` / `1、标题` 是书目风格章题；`3.14159` 是数字串不是标题
    let cs = split_txt("1. 开端\n\n正文一。\n\n2、逃亡\n\n正文二。\n\n3.14159 不是标题。");
    assert_eq!(titles(&cs), vec!["1. 开端", "2、逃亡"]);
    assert!(cs[1].content.contains("3.14159 不是标题。"));
}

#[test]
fn long_prose_line_is_not_a_heading() {
    // 超过 40 字的行是正文，即使恰好以「第N章」开头
    let long_line = format!("第一章{}。", "他推开门风雪灌进来灯晃了一下他坐下沉入回忆".repeat(3));
    let cs = split_txt(&format!("{long_line}\n\n第九章 归来\n\n正文。"));
    assert_eq!(titles(&cs), vec!["第九章 归来"]);
    assert!(cs[0].content.contains(&long_line), "长行归入正文不丢字");
}

#[test]
fn splits_typical_novel_with_volumes_and_special_chapters() {
    let cs = split_txt(SAMPLE);
    assert_eq!(titles(&cs), vec!["序章", "第一章 初见", "第二章 刀", "番外 后日谈"]);

    assert_eq!(cs[0].content, "那天夜里下着雪。");
    assert_eq!(cs[1].content, "他推开门。");
    assert_eq!(cs[2].content, "刀很冷。");
    assert_eq!(cs[3].content, "很多年以后。");

    // 卷行不单独成章，只作为其后各章的归属信息
    assert_eq!(cs[0].volume.as_deref(), Some("第一卷 风雪"));
    assert_eq!(cs[3].volume.as_deref(), Some("第一卷 风雪"));
}

#[test]
fn text_without_markers_becomes_single_chapter() {
    let cs = split_txt("他推开门。\n\n风雪灌进来。");
    assert_eq!(cs.len(), 1);
    assert_eq!(cs[0].title, "第一章");
    assert_eq!(cs[0].content, "他推开门。\n\n风雪灌进来。");
}

#[test]
fn bom_separates_multiple_documents() {
    // 两篇独立文档各自分章：前一篇的卷状态不串到后一篇
    let cs = split_txt("第一卷 甲\n\n第一章 一\n\n正文一。\u{feff}第二章 二\n\n正文二。");
    assert_eq!(titles(&cs), vec!["第一章 一", "第二章 二"]);
    assert_eq!(cs[0].volume.as_deref(), Some("第一卷 甲"));
    assert_eq!(cs[1].volume, None, "新文档不继承上一篇的卷");
}

#[test]
fn blank_lines_are_tolerated() {
    let cs = split_txt("\n\n\n第一章 一\n\n\n\n正文一。\n\n\n\n第二章 二\n\n正文二。\n\n\n");
    assert_eq!(titles(&cs), vec!["第一章 一", "第二章 二"]);
    assert_eq!(cs[0].content, "正文一。", "首尾空行被裁剪");
    assert_eq!(cs[1].content, "正文二。");
}

#[test]
fn prose_starting_with_di_x_tian_is_not_a_heading() {
    // `第.{0,20}?回` 会命中「第二天回家」——末尾句读判断用来挡住这类误切
    let cs = split_txt("第一章 初见\n\n他推开门。\n\n第二天回家。\n\n第三天回家。");
    assert_eq!(titles(&cs), vec!["第一章 初见"]);
    assert_eq!(cs[0].content, "他推开门。\n\n第二天回家。\n\n第三天回家。");
}

#[test]
fn long_heading_title_is_truncated() {
    let heading = format!("第一章 {}", "abcdefghijklmnopqrstuvwxyz0123456789");
    let cs = split_txt(&format!("{heading}\n\n正文。"));
    assert_eq!(cs[0].title.chars().count(), 35);
    assert!(cs[0].title.starts_with("第一章 "));
}

#[test]
fn indented_single_newline_paragraphs_are_normalized() {
    // 网文 txt 的原生形态：U+3000 缩进 + 单换行分段。
    // 落库必须转成「无缩进 + 空行分段」，否则 markdown 渲染整章叠成一段。
    let cs = split_txt("第一章 初见\n　　他推开门。\n　　风雪灌进来。\n　　灯晃了一下。");
    assert_eq!(cs.len(), 1);
    assert_eq!(cs[0].content, "他推开门。\n\n风雪灌进来。\n\n灯晃了一下。");
}

#[test]
fn normalize_is_idempotent_on_blank_line_paragraphs() {
    // 已规范化的文本（空行分段、无缩进）原样通过
    let cs = split_txt("第一章 一\n\n正文一。\n\n正文二。");
    assert_eq!(cs[0].content, "正文一。\n\n正文二。");
}

#[test]
fn preamble_before_first_heading_is_kept() {
    let cs = split_txt("楔子之前的一段引文。\n\n楔子\n\n正文。");
    assert_eq!(titles(&cs), vec!["楔子"]);
    assert!(cs[0].content.contains("楔子之前的一段引文。"), "前置正文不丢字");
    assert!(cs[0].content.contains("正文。"));
}

// ---- 导入落库 ----

#[test]
fn import_writes_chapter_files_and_reports() {
    let (_tmp, s) = setup();
    let book = cmd::create_book_inner(&s, "书").unwrap();
    let parsed = split_txt("第一章 一\n\n正文一。\n\n第二章 二\n\n正文二。");

    let report = import_chapters_inner(&s, book.id, &parsed).unwrap();
    assert_eq!(report.chapters, 2);
    assert_eq!(report.words, count_words("正文一。") + count_words("正文二。"));

    let chapters = cmd::list_chapters_inner(&s, book.id).unwrap();
    assert_eq!(chapters.len(), 2);
    assert_eq!(chapters[0].title, "第一章 一");
    assert_eq!(cmd::read_chapter_inner(&s, chapters[0].id).unwrap().content, "正文一。");
    assert_eq!(cmd::read_chapter_inner(&s, chapters[1].id).unwrap().content, "正文二。");
}

// ---- 导出 ----

fn imported_book(s: &AppState) -> i64 {
    let book = cmd::create_book_inner(s, "书").unwrap();
    import_chapters_inner(s, book.id, &split_txt(SAMPLE)).unwrap();
    book.id
}

#[test]
fn export_txt_indents_and_uses_crlf() {
    let (tmp, s) = setup();
    let book_id = imported_book(&s);
    let dest = tmp.path().join("out.txt");

    export_txt_inner(&s, book_id, &ExportRange::default(), true, &dest).unwrap();
    let text = std::fs::read_to_string(&dest).unwrap();

    assert!(text.contains("序章\r\n\r\n　　那天夜里下着雪。\r\n"), "章题 + 空行 + 段首缩进");
    assert!(text.contains("第一章 初见\r\n\r\n　　他推开门。\r\n"));
    assert!(!text.contains("\n\n\n"), "无多余空行");

    export_txt_inner(&s, book_id, &ExportRange::default(), false, &dest).unwrap();
    let plain = std::fs::read_to_string(&dest).unwrap();
    assert!(plain.contains("序章\r\n\r\n那天夜里下着雪。\r\n"), "关闭缩进");
}

#[test]
fn export_range_selects_subset_in_book_order() {
    let (tmp, s) = setup();
    let book_id = imported_book(&s);
    let chapters = cmd::list_chapters_inner(&s, book_id).unwrap();
    let dest = tmp.path().join("subset.txt");

    // 逆序勾选两章：输出仍按书内顺序
    let range = ExportRange { chapter_ids: vec![chapters[2].id, chapters[0].id] };
    export_txt_inner(&s, book_id, &range, false, &dest).unwrap();
    let text = std::fs::read_to_string(&dest).unwrap();

    assert!(text.contains("序章"));
    assert!(text.contains("第二章 刀"));
    assert!(!text.contains("第一章 初见"), "未勾选的章不出现");
    assert!(text.find("序章").unwrap() < text.find("第二章 刀").unwrap(), "按书内顺序");
}

#[test]
fn export_docx_is_valid_and_round_trips() {
    let (tmp, s) = setup();
    let book_id = imported_book(&s);
    let dest = tmp.path().join("out.docx");

    export_docx_inner(&s, book_id, &ExportRange::default(), &dest).unwrap();
    let bytes = std::fs::read(&dest).unwrap();
    assert_eq!(&bytes[..2], b"PK", "docx 是 zip 容器");

    // 回读：章题作为标题段落、正文段落都在
    let back = import_docx(&bytes).unwrap();
    let back_titles: Vec<&str> = back.iter().map(|c| c.title.as_str()).collect();
    assert_eq!(back_titles, vec!["序章", "第一章 初见", "第二章 刀", "番外 后日谈"]);
    assert!(back[1].content.contains("他推开门。"), "正文回读: {:?}", back[1].content);
}

#[test]
fn import_docx_rejects_non_docx_bytes() {
    assert!(import_docx(b"not a docx at all").is_err());
}
