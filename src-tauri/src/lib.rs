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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            commands::foreshadow_upsert,
            commands::foreshadow_set_status,
            commands::foreshadow_delete,
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
