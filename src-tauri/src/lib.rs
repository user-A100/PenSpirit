pub mod agents;
pub mod bump;
pub mod commands;
pub mod commands_ai;
pub mod context;
pub mod db;
pub mod error;
pub mod fs_service;
pub mod history;
pub mod llm;
pub mod models;
pub mod porting;
pub mod repo;
pub mod search;
pub mod sensitive;
pub mod state;
pub mod stats;
pub mod trash;
pub mod util;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// 启动前清 WebView2 磁盘缓存（Cache/Code Cache/GPUCache）。
///
/// Why: 应用升级换发新前端后，WebView2 可能继续从磁盘缓存吐旧 index/chunk，
/// 出现「跑的是旧版 UI / 部分功能莫名失效」的混合态（M3 期间实测踩坑两次）。
/// 只删三个缓存目录，Local Storage / IndexedDB（bixian.* 全部设置）保留；
/// 本地 asset 协议资源重建缓存开销可忽略。identifier 见 tauri.conf.json。
#[cfg(target_os = "windows")]
pub fn purge_webview2_cache() {
    let Ok(local) = std::env::var("LOCALAPPDATA") else { return };
    let base = std::path::Path::new(&local)
        .join("com.bixian.app")
        .join("EBWebView")
        .join("Default");
    for dir in ["Cache", "Code Cache", "GPUCache"] {
        let p = base.join(dir);
        if p.exists() {
            if let Err(e) = std::fs::remove_dir_all(&p) {
                eprintln!("bixian: 清 WebView2 缓存失败 {}: {e}", p.display());
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "windows")]
    purge_webview2_cache();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            app.manage(state::AppState::init(&dir)?);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::list_books,
            commands::create_book,
            commands::delete_book,
            commands::list_chapters,
            commands::create_chapter,
            commands::rename_chapter,
            commands::delete_chapter,
            commands::read_chapter,
            commands::write_chapter,
            commands::rescan_library,
            commands::list_trash,
            commands::restore_chapter,
            commands::purge_chapter,
            commands::empty_trash,
            commands::list_trash_books,
            commands::restore_book,
            commands::purge_book,
            commands::list_history,
            commands::read_history,
            commands::snapshot_now,
            commands::preview_import,
            commands::preview_import_dir,
            commands::import_chapters,
            commands::export_txt,
            commands::export_docx,
            commands::search_book,
            commands::bump_list_words,
            commands::bump_add_word,
            commands::bump_delete_word,
            commands::bump_clear_words,
            commands::bump_draw,
            commands::ideas_list,
            commands::ideas_create,
            commands::ideas_delete,
            commands::stats_add,
            commands::stats_today,
            commands::sensitive_get_words,
            commands::sensitive_set_words,
            commands::sensitive_scan,
            commands::sensitive_import_words,
            commands::setting_get,
            commands::setting_set,
            commands::stats_range,
            commands::books_set_target,
            commands::foreshadows_list,
            commands::characters_list,
            commands::character_upsert,
            commands::character_delete,
            commands::outlines_list,
            commands::outline_upsert,
            commands::outline_delete,
            commands::materials_list,
            commands::material_upsert,
            commands::material_delete,
            commands::plot_blocks_list,
            commands::plot_block_upsert,
            commands::plot_block_reorder,
            commands::plot_block_delete,
            commands::foreshadow_upsert,
            commands::foreshadow_set_status,
            commands::foreshadow_delete,
            commands::reading_bg_import,
            commands::reading_bg_list,
            commands::reading_bg_delete,
            commands_ai::list_providers,
            commands_ai::save_provider,
            commands_ai::delete_provider,
            commands_ai::set_active_provider,
            commands_ai::get_active_provider,
            commands_ai::list_styles,
            commands_ai::save_style,
            commands_ai::delete_style,
            commands_ai::set_active_style,
            commands_ai::get_active_style,
            commands_ai::list_sessions,
            commands_ai::get_or_create_session,
            commands_ai::list_messages,
            commands_ai::delete_message,
            commands_ai::send_message,
            commands_ai::cancel_generation,
            commands_ai::preview_context,
            agents::agents_list,
            agents::agents_probe,
            agents::agents_upsert,
            agents::agents_remove,
            agents::agents_set_default,
            agents::send_message_acp,
            agents::cancel_generation_acp,
            agents::agents_respond_permission,
        ])
        .run(tauri::generate_context!())
        .expect("error while running bixian application");
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::purge_webview2_cache;

    /// 临时 LOCALAPPDATA 下铺缓存三件套 + Local Storage，断言只删缓存、保留存储。
    /// set_var 仅本测试线程触达 LOCALAPPDATA（lib 内其余测试不读该变量）。
    #[test]
    fn purge_only_removes_cache_dirs() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let base = tmp.path().join("com.bixian.app").join("EBWebView").join("Default");
        for d in ["Cache", "Code Cache", "GPUCache", "Local Storage"] {
            let dir = base.join(d);
            std::fs::create_dir_all(&dir).expect("mkdir");
            std::fs::write(dir.join("sentinel"), b"x").expect("write");
        }
        std::env::set_var("LOCALAPPDATA", tmp.path());
        purge_webview2_cache();
        for d in ["Cache", "Code Cache", "GPUCache"] {
            assert!(!base.join(d).exists(), "{d} 应被删除");
        }
        assert!(
            base.join("Local Storage").join("sentinel").exists(),
            "Local Storage 必须保留"
        );
    }
}
