use rusqlite::{Connection, Result};
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

#[tauri::command]
pub fn init_db(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute_batch(
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
        CREATE TABLE IF NOT EXISTS path_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX IF NOT EXISTS idx_image_files_path ON image_files(path);
        INSERT OR IGNORE INTO image_config (key, value) VALUES ('image_path', '/data/apppic');"
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn add_item(state: State<DbState>, name: String) -> Result<i64, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO items (name) VALUES (?1)", [&name])
        .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_items(state: State<DbState>) -> Result<Vec<Item>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, created_at FROM items ORDER BY id DESC")
        .map_err(|e| e.to_string())?;
    let items = stmt.query_map([], |row| {
        Ok(Item {
            id: row.get(0)?,
            name: row.get(1)?,
            created_at: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(items)
}

#[tauri::command]
pub fn delete_item(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM items WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct Item {
    pub id: i64,
    pub name: String,
    pub created_at: String,
}

#[tauri::command]
pub fn save_image_alias(state: State<DbState>, filename: String, alias: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO image_aliases (filename, alias) VALUES (?1, ?2)",
        [&filename, &alias],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_image_aliases(state: State<DbState>) -> Result<std::collections::HashMap<String, String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT filename, alias FROM image_aliases")
        .map_err(|e| e.to_string())?;
    let aliases = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })
    .map_err(|e| e.to_string())?
    .filter_map(|r| r.ok())
    .collect();
    Ok(aliases)
}

#[derive(serde::Serialize)]
pub struct Server {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: i64,
    pub username: String,
    pub password: String,
}

#[tauri::command]
pub fn add_server(
    state: State<DbState>,
    id: String,
    name: String,
    host: String,
    port: i64,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO servers (id, name, host, port, username, password) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![id, name, host, port, username, password],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_servers(state: State<DbState>) -> Result<Vec<Server>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, host, port, username, password FROM servers ORDER BY name")
        .map_err(|e| e.to_string())?;
    let servers = stmt.query_map([], |row| {
        Ok(Server {
            id: row.get(0)?,
            name: row.get(1)?,
            host: row.get(2)?,
            port: row.get(3)?,
            username: row.get(4)?,
            password: row.get(5)?,
        })
    })
    .map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    Ok(servers)
}

#[tauri::command]
pub fn update_server(
    state: State<DbState>,
    id: String,
    name: String,
    host: String,
    port: i64,
    username: String,
    password: String,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE servers SET name = ?2, host = ?3, port = ?4, username = ?5, password = ?6 WHERE id = ?1",
        rusqlite::params![id, name, host, port, username, password],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_server(state: State<DbState>, id: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM servers WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_image_path(state: State<DbState>, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO image_config (key, value) VALUES ('image_path', ?1)",
        [&path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_image_path(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let path: Option<String> = conn.query_row(
        "SELECT value FROM image_config WHERE key = 'image_path'",
        [],
        |row| row.get(0),
    ).ok();
    Ok(path.unwrap_or_default())
}

#[tauri::command]
pub fn save_image_files(state: State<DbState>, files: Vec<String>, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM image_files WHERE path = ?1", [&path]).map_err(|e| e.to_string())?;
    for file in files {
        conn.execute(
            "INSERT OR IGNORE INTO image_files (filename, path) VALUES (?1, ?2)",
            [&file, &path],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_image_files(state: State<DbState>) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT filename FROM image_files ORDER BY filename")
        .map_err(|e| e.to_string())?;
    let files = stmt.query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
pub fn get_image_files_by_path(state: State<DbState>, path: String) -> Result<Vec<String>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT filename FROM image_files WHERE path = ?1 ORDER BY filename")
        .map_err(|e| e.to_string())?;
    let files = stmt.query_map([&path], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(files)
}

#[tauri::command]
pub fn get_db_tables(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare(
        "SELECT name, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=tbl.name) as cnt 
         FROM sqlite_master tbl WHERE type='table' ORDER BY name"
    ).map_err(|e| e.to_string())?;
    
    let tables = stmt.query_map([], |row| {
        let name: String = row.get(0)?;
        let mut count_stmt = conn.prepare(&format!("SELECT COUNT(*) FROM `{}`", name))?;
        let count: i64 = count_stmt.query_row([], |r| r.get(0))?;
        Ok((name, count))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<(String, i64)>, _>>()
    .map_err(|e| e.to_string())?;

    let result: Vec<serde_json::Value> = tables.into_iter()
        .map(|(name, count)| {
            serde_json::json!({
                "name": name,
                "count": count
            })
        })
        .collect();
    
    Ok(serde_json::to_string(&result).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn get_table_data(state: State<DbState>, table: String) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare(&format!("PRAGMA table_info(`{}`)", table))
        .map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut data_stmt = conn.prepare(&format!("SELECT * FROM `{}`", table))
        .map_err(|e| e.to_string())?;
    let rows: Vec<serde_json::Value> = data_stmt.query_map([], |row| {
        let mut obj = serde_json::Map::new();
        for (i, col) in columns.iter().enumerate() {
            let val_ref = row.get_ref(i);
            match val_ref {
                Ok(v) => {
                    let value: rusqlite::types::Value = v.clone().into();
                    let json_val = match value {
                        rusqlite::types::Value::Null => serde_json::json!(null),
                        rusqlite::types::Value::Integer(i) => serde_json::json!(i),
                        rusqlite::types::Value::Real(f) => serde_json::json!(f),
                        rusqlite::types::Value::Text(s) => serde_json::json!(s),
                        rusqlite::types::Value::Blob(b) => serde_json::json!(format!("[{}]", b.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(", "))),
                    };
                    obj.insert(col.clone(), json_val);
                }
                Err(_) => { 
                    obj.insert(col.clone(), serde_json::json!("")); 
                }
            }
        }
        Ok(serde_json::Value::Object(obj))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    let result = serde_json::json!({
        "columns": columns,
        "rows": rows
    });
    
    Ok(serde_json::to_string(&result).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn clear_table(state: State<DbState>, table: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(&format!("DELETE FROM `{}`", table), [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn reset_db(state: State<DbState>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    
    for table in tables {
        if table != "sqlite_sequence" {
            conn.execute(&format!("DROP TABLE IF EXISTS `{}`", table), [])
                .map_err(|e| e.to_string())?;
        }
    }
    
    conn.execute_batch(
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
            filename TEXT NOT NULL UNIQUE,
            path TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS path_list (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );"
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn add_path(state: State<DbState>, name: String, path: String) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO path_list (name, path) VALUES (?1, ?2)",
        [&name, &path],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_path_list(state: State<DbState>) -> Result<String, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT id, name, path, created_at FROM path_list ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let paths: Vec<serde_json::Value> = stmt.query_map([], |row| {
        Ok(serde_json::json!({
            "id": row.get::<_, i64>(0)?,
            "name": row.get::<_, String>(1)?,
            "path": row.get::<_, String>(2)?,
            "created_at": row.get::<_, String>(3)?,
        }))
    }).map_err(|e| e.to_string())?
    .collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;
    
    Ok(serde_json::to_string(&paths).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn delete_path(state: State<DbState>, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM path_list WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn insert_row(state: State<DbState>, table: String, columns: Vec<String>, values: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let placeholders: Vec<String> = (1..=values.len()).map(|i| format!("?{}", i)).collect();
    let cols_str = columns.iter().map(|c| format!("`{}`", c)).collect::<Vec<_>>().join(", ");
    let query = format!("INSERT INTO `{}` ({}) VALUES ({})", table, cols_str, placeholders.join(", "));
    
    conn.execute(&query, rusqlite::params_from_iter(values.iter()))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_row(state: State<DbState>, table: String, id: i64, columns: Vec<String>, values: Vec<String>) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    
    let set_clause: Vec<String> = columns.iter().enumerate()
        .map(|(i, c)| format!("`{}` = ?{}", c, i + 1))
        .collect();
    let query = format!("UPDATE `{}` SET {} WHERE id = ?{}", table, set_clause.join(", "), values.len() + 1);
    
    let id_str = id.to_string();
    let mut params: Vec<&str> = values.iter().map(|v| v.as_str()).collect();
    params.push(&id_str);
    
    conn.execute(&query, rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_row(state: State<DbState>, table: String, id: i64) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    conn.execute(&format!("DELETE FROM `{}` WHERE id = ?1", table), [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
