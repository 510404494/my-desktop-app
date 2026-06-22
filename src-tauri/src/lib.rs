mod db;

use rusqlite::Connection;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let app_handle = app.handle().clone();
            let db_path = app_handle
                .path()
                .app_data_dir()
                .expect("failed to get app data dir")
                .join("app.db");

            std::fs::create_dir_all(db_path.parent().unwrap()).ok();

            let conn = Connection::open(&db_path)
                .expect("failed to open database");

            conn.execute_batch("PRAGMA journal_mode=WAL;").ok();

            app.manage(db::DbState(Mutex::new(conn)));
            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            db::add_item,
            db::get_items,
            db::delete_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
