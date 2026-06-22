use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceConfig {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub device_type: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub data: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(rename = "scanPaths")]
    pub scan_paths: Vec<String>,
    #[serde(rename = "lastOpenPath")]
    pub last_open_path: String,
}

pub struct ConfigState(pub Mutex<AppConfig>);

#[tauri::command]
pub async fn fetch_json_from_url(url: String) -> Result<serde_json::Value, String> {
    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Failed to fetch URL: {}", e))?;

    let text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    serde_json::from_str(&text)
        .map_err(|e| format!("Failed to parse JSON: {}", e))
}

#[tauri::command]
pub fn export_to_json(data: serde_json::Value, path: String) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_to_csv(data: serde_json::Value, path: String) -> Result<(), String> {
    let mut csv = String::new();

    if let Some(obj) = data.as_object() {
        let keys: Vec<&str> = obj.keys().map(|s| s.as_str()).collect();
        csv.push_str(&keys.join(","));
        csv.push('\n');

        let values: Vec<String> = keys.iter().map(|k| {
            match obj.get(*k) {
                Some(serde_json::Value::String(s)) => format!("\"{}\"", s.replace('"', "\"\"")),
                Some(v) => v.to_string(),
                None => String::new(),
            }
        }).collect();
        csv.push_str(&values.join(","));
    }

    fs::write(&path, csv).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn scan_directory(path: String) -> Result<Vec<DeviceConfig>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err("Not a directory".to_string());
    }

    let mut devices = Vec::new();
    scan_json_files(dir, &mut devices, &path)?;
    Ok(devices)
}

fn scan_json_files(dir: &Path, devices: &mut Vec<DeviceConfig>, base_path: &str) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            scan_json_files(&path, devices, base_path)?;
        } else if path.extension().map_or(false, |ext| ext == "json") {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(data) = serde_json::from_str::<serde_json::Value>(&content) {
                    let file_name = path.file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Unknown".to_string());

                    let relative_path = path.strip_prefix(base_path)
                        .map(|p| p.to_string_lossy().to_string())
                        .unwrap_or_else(|_| path.to_string_lossy().to_string());

                    let dir_name = path.parent()
                        .and_then(|p| p.file_name())
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_else(|| "Uncategorized".to_string());

                    devices.push(DeviceConfig {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: file_name,
                        device_type: dir_name,
                        file_path: relative_path,
                        data,
                    });
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn load_file(path: String) -> Result<DeviceConfig, String> {
    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let data: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let file_name = Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    Ok(DeviceConfig {
        id: uuid::Uuid::new_v4().to_string(),
        name: file_name,
        device_type: "manual".to_string(),
        file_path: path,
        data,
    })
}

#[tauri::command]
pub fn save_device(file_path: String, data: serde_json::Value) -> Result<(), String> {
    let content = serde_json::to_string_pretty(&data).map_err(|e| e.to_string())?;
    fs::write(&file_path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_config(state: State<ConfigState>) -> Result<AppConfig, String> {
    let config = state.0.lock().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub fn save_config(state: State<ConfigState>, scan_paths: Vec<String>) -> Result<(), String> {
    let mut config = state.0.lock().map_err(|e| e.to_string())?;
    config.scan_paths = scan_paths;
    Ok(())
}
