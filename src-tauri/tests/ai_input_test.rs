//! 阶段 2C 组 2：附件、词语偏置（AI 腔禁用表）、正文里的 {批注} / [待写指令]。

use bixian::commands as m0;
use bixian::commands_ai as cmd;
use bixian::context::{assemble, AssembleInput, InjectionInput};
use bixian::models::{AiTurnOptions, Attachment, ProviderProfile};
use bixian::porting::export::{export_docx_inner, ExportRange};
use bixian::state::AppState;

fn setup() -> (tempfile::TempDir, AppState) {
    let tmp = tempfile::tempdir().unwrap();
    let state = AppState::test_state(tmp.path());
    (tmp, state)
}

fn provider(s: &AppState) {
    let p = cmd::save_provider_inner(
        s,
        ProviderProfile { id: 0, name: "测".into(), base_url: "https://api.test/v1".into(), api_key: "sk".into(), model: "m".into(), max_tokens: 1024, temperature: 0.7 },
    )
    .unwrap();
    cmd::set_active_provider_inner(s, p.id).unwrap();
}

#[test]
fn 组装_用词要求_作者批注_附件() {
    let long = "字".repeat(bixian::context::assembler::ATTACHMENT_MAX_CHARS + 50);
    let a = assemble(&AssembleInput {
        book_title: "书",
        chapter_text: "正文。",
        instruction: "写",
        phrase_bias: Some("不要使用这些表达（AI 腔）：嘴角勾起一抹弧度"),
        notes: vec!["林晚还不知道真相".into()],
        attachments: vec![("参考.txt".into(), "参考稿内容".into()), ("长稿.md".into(), long)],
        ..Default::default()
    });
    assert!(a.system.contains("【用词要求】\n不要使用这些表达（AI 腔）：嘴角勾起一抹弧度"));
    assert!(a.system.contains("【作者批注（只遵守，不要写进正文）】\n- 林晚还不知道真相"));
    assert!(a.user.contains("【附件（参考资料，借鉴其内容或风格，不要照抄）】\n《参考.txt》\n参考稿内容"));
    let att = a.log.slots.iter().find(|s| s.name == "附件").unwrap();
    assert!(att.reason.contains("参考.txt、长稿.md"));
    assert!(att.chars < (bixian::context::assembler::ATTACHMENT_MAX_CHARS + 100) as i64, "超长附件截到上限");
    assert!(a.user.find("【附件").unwrap() < a.user.find("【写作指令】").unwrap());
}

#[test]
fn 超预算时附件先于引用资料被裁() {
    let a = assemble(&AssembleInput {
        book_title: "书",
        chapter_text: "正文。",
        instruction: "写",
        injections: vec![InjectionInput { name: "引用资料".into(), source: "@".into(), text: "引".repeat(300), budget: 0, reason: String::new() }],
        attachments: vec![("a.txt".into(), "附".repeat(3000))],
        budget_tokens: Some(800),
        ..Default::default()
    });
    let slot = |n: &str| a.log.slots.iter().find(|s| s.name == n).unwrap().clone();
    assert!(slot("附件").trimmed);
    assert!(!slot("引用资料").trimmed);
    assert!(!a.user.contains("【附件"));
}

#[test]
fn 正文里的指令从上下文剔除_批注单列_真实发送路径() {
    let (_tmp, s) = setup();
    provider(&s);
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    m0::write_chapter_inner(&s, ch.id, "林晚推门而入。{她此时还不知道真相}\n[这里写一场雨中打斗]\n雨很大。").unwrap();
    let sess = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let t = cmd::send_prepare(&s, sess.id, "续写", &AiTurnOptions::default()).unwrap();
    assert!(t.req.system.contains("- 她此时还不知道真相"));
    assert!(!t.req.user.contains("{她此时") && !t.req.user.contains("[这里写"));
    assert!(t.req.user.contains("林晚推门而入。") && t.req.user.contains("雨很大。"));
    cmd::cancel_generation_inner(&s, sess.id).ok();
    // 光标后文里的批注也算本章批注
    let opts = AiTurnOptions { cursor_before: Some("前文。".into()), cursor_after: Some("后文。{后面的批注}".into()), ..Default::default() };
    let t2 = cmd::send_prepare(&s, sess.id, "续写", &opts).unwrap();
    assert!(t2.req.system.contains("- 后面的批注"));
    assert!(!t2.req.user.contains("{后面"));
}

#[test]
fn 词语偏置_范围去重导入与注入() {
    let (_tmp, s) = setup();
    provider(&s);
    let book = m0::create_book_inner(&s, "书").unwrap();
    let other = m0::create_book_inner(&s, "别的书").unwrap();
    assert!(cmd::phrase_bias_add_inner(&s, None, "嘴角勾起一抹弧度", "ban").unwrap());
    assert!(!cmd::phrase_bias_add_inner(&s, None, " 嘴角勾起一抹弧度 ", "ban").unwrap(), "同范围同类去重");
    assert!(cmd::phrase_bias_add_inner(&s, Some(book.id), "冷笑", "ban").unwrap());
    assert!(cmd::phrase_bias_add_inner(&s, Some(book.id), "凛冽", "prefer").unwrap());
    cmd::phrase_bias_add_inner(&s, Some(other.id), "别书专用", "ban").unwrap();
    assert!(cmd::phrase_bias_add_inner(&s, None, "", "ban").is_err());
    assert!(cmd::phrase_bias_add_inner(&s, None, "x", "weird").is_err());
    let list = cmd::phrase_bias_list_inner(&s, Some(book.id)).unwrap();
    let names: Vec<&str> = list.iter().map(|p| p.phrase.as_str()).collect();
    assert_eq!(names[0], "嘴角勾起一抹弧度", "通用在前");
    assert!(names.contains(&"冷笑") && names.contains(&"凛冽") && !names.contains(&"别书专用"));
    // 一键导入常见 AI 腔：已有的跳过
    assert_eq!(cmd::phrase_bias_import_defaults_inner(&s, None).unwrap(), 19);
    assert_eq!(cmd::phrase_bias_import_defaults_inner(&s, None).unwrap(), 0);
    // 注入
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    let sess = cmd::get_or_create_session_inner(&s, ch.id).unwrap();
    let t = cmd::send_prepare(&s, sess.id, "写", &AiTurnOptions::default()).unwrap();
    assert!(t.req.system.contains("【用词要求】"));
    assert!(t.req.system.contains("冷笑") && t.req.system.contains("合适时可以多用：凛冽") && !t.req.system.contains("别书专用"));
    // 删除
    let id = list.iter().find(|p| p.phrase == "冷笑").unwrap().id;
    cmd::phrase_bias_delete_inner(&s, id).unwrap();
    assert!(!cmd::phrase_bias_list_inner(&s, Some(book.id)).unwrap().iter().any(|p| p.phrase == "冷笑"));
    // 删书连带本书的条目
    m0::delete_book_inner(&s, other.id).unwrap();
    bixian::trash::purge_book_inner(&s, other.id).unwrap();
    assert!(!cmd::phrase_bias_list_inner(&s, Some(other.id)).unwrap().iter().any(|p| p.phrase == "别书专用"));
}

#[test]
fn 读附件_txt编码识别_docx_截断_拒绝其它类型() {
    let (tmp, s) = setup();
    // GBK 编码的 txt（一段正常长度的参考稿；四五个字的样本编码识别本来就判不准）
    let src = "渡口的灯笼次第亮起，沈砚站在船头，望着旧城的方向。雨下得很急，林晚撑着伞走来。";
    let (gbk, _, _) = encoding_rs::GBK.encode(src);
    let p = tmp.path().join("参考.txt");
    std::fs::write(&p, &gbk).unwrap();
    let r = cmd::attachment_read_inner(&p).unwrap();
    assert_eq!((r.name.as_str(), r.text.as_str(), r.truncated), ("参考.txt", src, false));
    // docx（用导出功能造一份）
    let book = m0::create_book_inner(&s, "书").unwrap();
    let ch = m0::create_chapter_inner(&s, book.id, "一").unwrap();
    m0::write_chapter_inner(&s, ch.id, "渡口的灯笼次第亮起。").unwrap();
    let dx = tmp.path().join("样本.docx");
    export_docx_inner(&s, book.id, &ExportRange::default(), &dx).unwrap();
    assert!(cmd::attachment_read_inner(&dx).unwrap().text.contains("渡口的灯笼次第亮起"));
    // 过长截断
    let big = tmp.path().join("长.md");
    std::fs::write(&big, "字".repeat(cmd::ATTACHMENT_READ_MAX_CHARS + 10)).unwrap();
    let r = cmd::attachment_read_inner(&big).unwrap();
    assert!(r.truncated && r.text.chars().count() == cmd::ATTACHMENT_READ_MAX_CHARS && r.chars == (cmd::ATTACHMENT_READ_MAX_CHARS + 10) as i64);
    // 其它类型
    let bad = tmp.path().join("x.pdf");
    std::fs::write(&bad, b"%PDF").unwrap();
    assert!(cmd::attachment_read_inner(&bad).is_err());
    let _ = Attachment::default();
}
