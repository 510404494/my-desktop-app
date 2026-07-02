mod db;
mod files;
mod terminal;

use rusqlite::Connection;
use std::sync::{Mutex, Arc};
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

            let conn = match Connection::open(&db_path) {
                Ok(c) => c,
                Err(_) => {
                    let _ = std::fs::remove_file(&db_path);
                    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));
                    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
                    Connection::open(&db_path).expect("failed to open database")
                }
            };

            let _ = conn.execute_batch("PRAGMA journal_mode=WAL;");
            let _ = conn.execute_batch("PRAGMA busy_timeout=5000;");

            let _ = conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE IF NOT EXISTS image_aliases (
                    filename TEXT PRIMARY KEY,
                    alias TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS servers (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    password TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS image_config (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS image_files (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    path TEXT NOT NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(filename, path)
                );
                CREATE INDEX IF NOT EXISTS idx_image_files_path ON image_files(path);
                INSERT OR IGNORE INTO image_config (key, value) VALUES ('image_path', '/data/apppic');"
        );

            app.manage(db::DbState(Mutex::new(conn)));

            let config = files::AppConfig {
                scan_paths: Vec::new(),
                last_open_path: String::new(),
            };
            app.manage(files::ConfigState(Mutex::new(config)));

            app.manage(terminal::TerminalState(Arc::new(Mutex::new(None))));

            Ok(())
        })
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db::init_db,
            db::add_item,
            db::get_items,
            db::delete_item,
            db::save_image_alias,
            db::get_image_aliases,
            db::add_server,
            db::get_servers,
            db::update_server,
            db::delete_server,
            db::save_image_path,
            db::get_image_path,
            db::save_image_files,
            db::get_image_files,
            db::get_image_files_by_path,
            db::get_db_tables,
            db::get_table_data,
            db::clear_table,
            db::reset_db,
            db::add_path,
            db::get_path_list,
            db::delete_path,
            db::insert_row,
            db::update_row,
            db::delete_row,
            files::scan_directory,
            files::load_file,
            files::save_device,
            files::load_config,
            files::save_config,
            files::fetch_json_from_url,
            files::export_to_json,
            files::export_to_csv,
            files::list_server_files,
            files::download_server_file,
            files::read_server_file,
            files::execute_jumpserver_cmd,
            files::test_server_connection,
            terminal::terminal_connect,
            terminal::terminal_send,
            terminal::terminal_disconnect,
            terminal::terminal_is_connected,
            terminal::terminal_list_files,
            terminal::terminal_upload_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
