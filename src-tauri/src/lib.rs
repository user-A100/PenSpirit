pub mod commands;
pub mod context;
pub mod db;
pub mod error;
pub mod fs_service;
pub mod llm;
pub mod models;
pub mod repo;
pub mod state;
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running bixian application");
}
